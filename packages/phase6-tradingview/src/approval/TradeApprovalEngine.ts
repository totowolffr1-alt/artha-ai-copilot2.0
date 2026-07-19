/**
 * packages/phase6-tradingview/src/approval/TradeApprovalEngine.ts
 * Artha AI — Phase 6 Risk Engine
 *
 * Outermost engine — the single entry point for Phase 7.
 *
 * Evaluation flow:
 *   1. Check CircuitBreaker — if TRIPPED, REJECT immediately
 *   2. Run Stage 0 MarketRiskEngine — if hard_block, REJECT immediately
 *   3. Run RiskValidationPipeline (Stages 1–5)
 *   4. Compute composite confidence
 *   5. Downgrade to REDUCED_SIZE if confidence < min_confidence_to_approve
 *   6. Return TradeApprovalResult
 *
 * Confidence formula:
 *   confidence = (stage_score × 0.40) + (conviction × 0.35) + (market_multiplier × 0.25)
 */

import {
  SignalEvent, PortfolioSnapshot, TradeApprovalResult, TradeDecision,
  MarketRiskContext, ApprovalConfig,
} from '../types';
import { ITradeApprovalEngine } from '../contracts/ITradeApprovalEngine';
import { CircuitBreaker } from '../breaker/CircuitBreaker';
import { MarketRiskEngine, MarketRiskEngineInputs } from '../market/MarketRiskEngine';
import { RiskValidationPipeline } from '../pipeline/RiskValidationPipeline';

export class TradeApprovalEngine implements ITradeApprovalEngine {
  constructor(
    private readonly circuitBreaker:   CircuitBreaker,
    private readonly marketRiskEngine:  MarketRiskEngine,
    private readonly pipeline:          RiskValidationPipeline,
    private readonly getMarketInputs:   (signal: SignalEvent) => MarketRiskEngineInputs,
    private readonly cfg:               ApprovalConfig,
  ) {}

  evaluate(signal: SignalEvent, portfolio: PortfolioSnapshot): TradeApprovalResult {
    const evaluated_at = new Date();

    // ── Gate 1: Circuit Breaker ──────────────────────────────────
    if (!this.circuitBreaker.isArmed()) {
      const status = this.circuitBreaker.getStatus();
      return this.buildResult(signal, evaluated_at, 'REJECTED', 0, 0, 0, 0, 0,
        `Circuit breaker ${status.state}: ${status.reason}`,
        null,
      );
    }

    // ── Gate 2: Stage 0 Market Context ──────────────────────────
    const marketInputs = this.getMarketInputs(signal);
    const marketCtx: MarketRiskContext = this.marketRiskEngine.getContext(marketInputs, evaluated_at);

    if (marketCtx.hard_block) {
      return this.buildResult(signal, evaluated_at, 'REJECTED', 0, 0, 0, 0, 0,
        `Market hard block (${marketCtx.market_state}): ${marketCtx.hard_block_reason}`,
        marketCtx,
      );
    }

    // ── Gate 3: Pipeline (Stages 1–5) ───────────────────────────
    const pipelineResult = this.pipeline.validateWithContext(signal, portfolio, marketCtx);

    if (!pipelineResult.passed) {
      // Compute confidence even for rejections (for audit)
      const confidence = this.computeConfidence(
        pipelineResult.stage / 5,
        0,  // No conviction available after rejection
        marketCtx.risk_budget_multiplier,
      );
      return this.buildResult(signal, evaluated_at, 'REJECTED', 0, confidence,
        pipelineResult.stage, 0, portfolio.total_portfolio_value,
        pipelineResult.reason,
        marketCtx,
      );
    }

    // ── Gate 4: Confidence Calculation ──────────────────────────
    const stage_score = pipelineResult.stage / 5;
    const features = signal.features as any;
    const conviction: number =
      typeof features?.conviction === 'number'
        ? features.conviction
        : signal.strength * signal.kelly_fraction;

    const confidence = this.computeConfidence(
      stage_score,
      conviction,
      marketCtx.risk_budget_multiplier,
    );

    // ── Gate 5: Confidence Threshold ────────────────────────────
    let decision: TradeDecision =
      pipelineResult.verdict === 'REDUCED_SIZE' ? 'REDUCED_SIZE' : 'APPROVED';

    if (confidence < this.cfg.min_confidence_to_approve) {
      decision = 'REDUCED_SIZE';
    }

    return this.buildResult(
      signal,
      evaluated_at,
      decision,
      pipelineResult.adjusted_qty,
      confidence,
      pipelineResult.stage,
      conviction,
      pipelineResult.adjusted_qty * signal.entry_price_hint,
      pipelineResult.reason,
      marketCtx,
    );
  }

  resetForFold(): void {
    this.pipeline.resetForFold();
    this.marketRiskEngine.invalidateCache();
  }

  private computeConfidence(
    stage_score: number,
    conviction: number,
    market_multiplier: number,
  ): number {
    return (
      stage_score      * this.cfg.confidence_weight_stages +
      conviction       * this.cfg.confidence_weight_conviction +
      market_multiplier * this.cfg.confidence_weight_market
    );
  }

  private buildResult(
    signal: SignalEvent,
    evaluated_at: Date,
    decision: TradeDecision,
    qty: number,
    confidence: number,
    stage_reached: number,
    conviction: number,
    suggested_size: number,
    reason: string,
    marketCtx: MarketRiskContext | null,
  ): TradeApprovalResult {
    return {
      decision,
      confidence: Math.min(1, Math.max(0, confidence)),
      suggestedSize: suggested_size,
      reasons: [reason],
      signal_id: signal.signal_id,
      evaluated_at,
      market_state: marketCtx?.market_state ?? 'NEUTRAL',
      risk_budget_multiplier: marketCtx?.risk_budget_multiplier ?? 1.0,
      stage_reached,
      conviction_score: conviction,
      max_safe_qty: qty,
      sizing_method: 'atr_kelly',
    };
  }
}
