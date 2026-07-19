/**
 * packages/phase6-tradingview/src/sizer/ConvictionSizer.ts
 * Artha AI — Phase 6 Risk Engine — Stage 1
 *
 * Facade that wires ConvictionScorer → PositionSizer.
 * This is the single entry point for Stage 1 sizing calculations.
 */

import { SignalEvent, PortfolioSnapshot, MarketRiskContext, RiskConfig } from '../types';
import { ConvictionScorer } from './ConvictionScorer';
import { PositionSizer, PositionSizerResult } from './PositionSizer';

export interface ConvictionSizerResult extends PositionSizerResult {
  conviction: number;
}

export class ConvictionSizer {
  private readonly convictionScorer = new ConvictionScorer();
  private readonly positionSizer    = new PositionSizer();

  size(
    signal: SignalEvent,
    portfolio: PortfolioSnapshot,
    context: MarketRiskContext,
    cfg: RiskConfig,
    spread_pct: number,
  ): ConvictionSizerResult {
    const features = signal.features as any;

    // Extract regime confidence (stored in features by Phase 5)
    const regime_confidence: number =
      typeof features?.regime_confidence === 'number'
        ? features.regime_confidence
        : 0.50;

    // Extract ATR from features
    const atr: number =
      typeof features?.indicators_snapshot?.atr === 'number'
        ? features.indicators_snapshot.atr
        : signal.entry_price_hint * 0.02;  // 2% ATR fallback

    const convictionResult = this.convictionScorer.score({
      strength:           signal.strength,
      kelly_fraction:     signal.kelly_fraction,
      regime_confidence,
      spread_pct,
    });

    const sizerResult = this.positionSizer.size({
      available_capital:         portfolio.cash_available,
      entry_price:               signal.entry_price_hint,
      stop_loss:                 signal.stop_loss,
      atr,
      atr_fallback_multiplier:   2.0,
      kelly_fraction:            signal.kelly_fraction,
      conviction:                convictionResult.conviction,
      max_risk_per_trade_pct:    cfg.max_risk_per_trade_pct,
      max_capital_per_trade_pct: cfg.max_capital_per_trade_pct,
      risk_budget_multiplier:    context.risk_budget_multiplier,
      min_tradeable_qty:         cfg.min_tradeable_qty,
    });

    return {
      ...sizerResult,
      conviction: convictionResult.conviction,
    };
  }
}
