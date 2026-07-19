/**
 * packages/phase6-tradingview/src/pipeline/RiskValidationPipeline.ts
 * Artha AI — Phase 6 Risk Engine
 *
 * Runs the 5 risk validation stages in order.
 * Each stage can:
 *   - PASS: continue with same or reduced qty
 *   - REJECT: short-circuit, return immediate REJECTED result
 *
 * Stage order:
 *   1. Technical (sizer, exposure, portfolio overlap, capital)
 *   2. Volatility (ATR%, HV20, VaR, drawdown)
 *   3. Regime (direction vs market state, Nifty EMA200)
 *   4. Liquidity (ADV, ADT, spread, participation cap)
 *   5. Swing (event risk, market status, overnight gap, news)
 */

import {
  SignalEvent, PortfolioSnapshot, RiskConfig, MarketRiskContext,
  RiskValidationResult, StageValidationResult,
} from '../types';
import { IRiskValidationPipeline } from '../contracts/IRiskValidationPipeline';
import { createPipelineContext } from './PipelineContext';

// Stage 1 — Technical
import { ConvictionSizer } from '../sizer/ConvictionSizer';
import { ExposureManager } from '../exposure/ExposureManager';
import { CapitalChecker } from '../capital/CapitalChecker';
import { PortfolioRiskEngine } from '../portfolio/PortfolioRiskEngine';
import { IMarketDataCache } from '../contracts/IMarketDataCache';

// Stage 2 — Volatility
import { VolatilityAnalyser } from '../volatility/VolatilityAnalyser';
import { PortfolioVaR } from '../var/PortfolioVaR';
import { DrawdownTracker } from '../drawdown/DrawdownTracker';

// Stage 3 — Regime
import { RegimeFilter } from '../regime/RegimeFilter';
import { NiftyTrendGuard } from '../regime/NiftyTrendGuard';

// Stage 4 — Liquidity
import { LiquidityChecker } from '../liquidity/LiquidityChecker';

// Stage 5 — Swing
import { EventRiskChecker, UpcomingEvent } from '../events/EventRiskChecker';
import { MarketStatusChecker } from '../market_status/MarketStatusChecker';
import { OvernightGapRiskChecker } from '../gap/OvernightGapRiskChecker';
import { NewsImpactRiskChecker } from '../events/NewsImpactRiskChecker';

export interface PipelineComponents {
  // Stage 1
  convictionSizer:     ConvictionSizer;
  exposureManager:     ExposureManager;
  capitalChecker:      CapitalChecker;
  portfolioRiskEngine: PortfolioRiskEngine;
  marketDataCache:     IMarketDataCache;
  // Stage 2
  volatilityAnalyser:  VolatilityAnalyser;
  portfolioVaR:        PortfolioVaR;
  drawdownTracker:     DrawdownTracker;
  // Stage 3
  regimeFilter:        RegimeFilter;
  niftyTrendGuard:     NiftyTrendGuard;
  // Stage 4
  liquidityChecker:    LiquidityChecker;
  // Stage 5
  eventRiskChecker:    EventRiskChecker;
  marketStatusChecker: MarketStatusChecker;
  gapRiskChecker:      OvernightGapRiskChecker;
  newsChecker:         NewsImpactRiskChecker;
  // Data provider for events
  getUpcomingEvents:   (symbol_id: string) => UpcomingEvent[];
}

export class RiskValidationPipeline implements IRiskValidationPipeline {
  constructor(
    private readonly c: PipelineComponents,
    private readonly cfg: RiskConfig,
  ) {}

  validate(signal: SignalEvent, portfolio: PortfolioSnapshot): RiskValidationResult {
    const context = portfolio as any; // MarketRiskContext is passed via closures in real usage
    return this._validate(signal, portfolio, null as any);
  }

  validateWithContext(
    signal: SignalEvent,
    portfolio: PortfolioSnapshot,
    marketCtx: MarketRiskContext,
  ): RiskValidationResult {
    return this._validate(signal, portfolio, marketCtx);
  }

  private _validate(
    signal: SignalEvent,
    portfolio: PortfolioSnapshot,
    marketCtx: MarketRiskContext,
  ): RiskValidationResult {
    const { c, cfg } = this;
    const features = signal.features as any;

    // ── Stage 1: Technical ───────────────────────────────────────
    const spread_pct = this.getSpreadPct(signal.symbol_id, signal.entry_price_hint);
    const sized = c.convictionSizer.size(signal, portfolio, marketCtx, cfg, spread_pct);
    if (sized.qty <= 0) {
      return this.reject(1, sized.qty, 'Stage 1: Sizer returned 0 qty — insufficient capital or high risk');
    }

    const ticker: string = features?.ticker ?? signal.symbol_id;

    const exposure = c.exposureManager.check(
      signal.symbol_id, ticker, sized.qty, signal.entry_price_hint, portfolio, cfg
    );
    if (!exposure.passed) {
      return this.reject(1, 0, `Stage 1: Exposure limit breach — ${exposure.detail}`);
    }

    const capital = c.capitalChecker.check(exposure.adjusted_qty, signal.entry_price_hint, portfolio, cfg, marketCtx);
    if (!capital.passed) {
      return this.reject(1, 0, `Stage 1: ${capital.reason}`);
    }

    const portRisk = c.portfolioRiskEngine.evaluate(
      signal.symbol_id, ticker, signal.direction, exposure.adjusted_qty, portfolio, cfg
    );
    if (!portRisk.passed) {
      return this.reject(1, 0, `Stage 1: Portfolio risk — ${portRisk.detail}`);
    }

    let qty = portRisk.adjusted_qty;
    const ctx = createPipelineContext(qty, sized.conviction, sized.method);

    // ── Stage 2: Volatility ──────────────────────────────────────
    ctx.stage_reached = 2;
    const atr_pct: number = features?.indicators_snapshot?.atr_pct ?? 0.02;
    const hv_20: number   = features?.indicators_snapshot?.hv_20   ?? 0.30;
    const spike_ratio     = 1.0;  // Would come from cache in live usage

    const volCheck = c.volatilityAnalyser.check({
      atr_pct, hv_20, spike_ratio,
      max_atr_pct:       0.05,
      max_hv_20:         0.80,
      spike_ratio_cap:   2.0,
      max_positions:     marketCtx?.max_positions_override ?? cfg.max_open_trades,
    });
    qty = Math.floor(qty * volCheck.size_multiplier);
    if (!volCheck.passed) {
      return this.reject(2, 0, `Stage 2: Extreme volatility — ${volCheck.detail}`);
    }
    if (volCheck.size_multiplier < 1.0) ctx.reasons.push(`Volatility reduction ×${volCheck.size_multiplier.toFixed(2)}`);

    const varCheck = c.portfolioVaR.check({
      new_symbol_id:        signal.symbol_id,
      new_qty:              qty,
      new_entry_price:      signal.entry_price_hint,
      portfolio,
      max_portfolio_var_pct: cfg.max_portfolio_var_pct,
      var_limit_multiplier:  marketCtx?.var_limit_multiplier ?? 1.0,
    });
    if (!varCheck.passed && varCheck.adjusted_qty <= 0) {
      return this.reject(2, 0, `Stage 2: VaR limit breached — ${varCheck.detail}`);
    }
    qty = varCheck.adjusted_qty > 0 ? varCheck.adjusted_qty : qty;
    if (varCheck.adjusted_qty < qty) ctx.reasons.push(`VaR reduction → qty=${varCheck.adjusted_qty}`);

    const ddCheck = c.drawdownTracker.validate(
      cfg.max_daily_drawdown_pct,
      cfg.max_weekly_drawdown_pct,
      cfg.max_monthly_drawdown_pct,
      marketCtx?.dd_limit_multiplier ?? 1.0,
    );
    if (!ddCheck.passed) {
      return this.reject(2, 0, `Stage 2: Drawdown limit breached (${ddCheck.breached_horizon}) — ${ddCheck.detail}`);
    }

    // ── Stage 3: Regime ──────────────────────────────────────────
    ctx.stage_reached = 3;
    const regimeResult = c.regimeFilter.filter(signal.direction, marketCtx?.market_state ?? 'NEUTRAL');
    if (!regimeResult.passed) {
      return this.reject(3, 0, `Stage 3: ${regimeResult.reject_reason}`);
    }
    qty = Math.floor(qty * regimeResult.size_multiplier);
    if (regimeResult.size_multiplier < 1.0) ctx.reasons.push(`Regime size reduction ×${regimeResult.size_multiplier}`);

    const niftyGuard = c.niftyTrendGuard.check(
      signal.direction,
      marketCtx?.nifty_price ?? 0,
      marketCtx?.nifty_ema200 ?? 0,
    );
    qty = Math.floor(qty * niftyGuard.size_multiplier);
    if (niftyGuard.size_multiplier < 1.0) ctx.reasons.push(`Nifty EMA200 guard ×${niftyGuard.size_multiplier}`);

    // ── Stage 4: Liquidity ───────────────────────────────────────
    ctx.stage_reached = 4;
    const adv_shares  = c.marketDataCache.getADV(signal.symbol_id);
    const adt_crores  = c.marketDataCache.getADT(signal.symbol_id);

    const liqCheck = c.liquidityChecker.check({
      symbol_id: signal.symbol_id,
      ticker,
      qty,
      entry_price: signal.entry_price_hint,
      adv_shares,
      adt_crores,
      spread_pct,
      min_adv_shares: 50_000,
      min_adt_crores: 5,
      max_spread_pct: 0.20,
      max_adv_participation_pct: 0.02,
    });
    if (!liqCheck.passed) {
      return this.reject(4, 0, `Stage 4: Liquidity — ${liqCheck.reject_reason ?? liqCheck.detail}`);
    }
    qty = liqCheck.adjusted_qty;
    if (liqCheck.binding_limit === 'participation') ctx.reasons.push(`ADV participation cap → qty=${qty}`);

    // ── Stage 5: Swing Risk ──────────────────────────────────────
    ctx.stage_reached = 5;
    const statusCheck = c.marketStatusChecker.check(signal.symbol_id, cfg);
    if (!statusCheck.passed) {
      return this.reject(5, 0, `Stage 5: Regulatory — ${statusCheck.reason}: ${statusCheck.detail}`);
    }

    const hold_days: number = features?.expected_hold_days ?? 3;
    const upcoming_events = c.getUpcomingEvents(signal.symbol_id);
    const eventCheck = c.eventRiskChecker.check(signal.symbol_id, upcoming_events, hold_days, cfg);
    if (!eventCheck.passed) {
      return this.reject(5, 0, `Stage 5: Event risk — ${eventCheck.reject_reason}`);
    }
    qty = Math.floor(qty * eventCheck.size_multiplier);
    if (eventCheck.size_multiplier < 1.0) ctx.reasons.push(`Event risk reduction ×${eventCheck.size_multiplier} (${eventCheck.gap_tier})`);

    const hold_nights = Math.max(1, hold_days);
    const vix_current = marketCtx?.vix_current ?? 15;
    const gapCheck = c.gapRiskChecker.check(signal.symbol_id, hold_nights, vix_current, cfg);
    if (!gapCheck.passed) {
      return this.reject(5, 0, `Stage 5: Gap risk — ${gapCheck.reason}`);
    }
    // Apply gap multiplier derived from tier
    const gapMultiplier =
      gapCheck.metrics.risk_tier === 'HIGH'   ? cfg.gap_high_size_multiplier :
      gapCheck.metrics.risk_tier === 'MEDIUM' ? cfg.gap_medium_size_multiplier : 1.0;
    qty = Math.floor(qty * gapMultiplier);
    if (gapMultiplier < 1.0) ctx.reasons.push(`Overnight gap risk ×${gapMultiplier} (${gapCheck.metrics.risk_tier})`);

    const newsCheck = c.newsChecker.check(signal.symbol_id, cfg);
    if (!newsCheck.passed) {
      return this.reject(5, 0, `Stage 5: News — ${newsCheck.reject_reason}`);
    }
    qty = Math.floor(qty * newsCheck.size_multiplier);
    if (newsCheck.size_multiplier < 1.0) ctx.reasons.push(`News impact reduction ×${newsCheck.size_multiplier}`);

    // ── Final qty check ──────────────────────────────────────────
    if (qty < cfg.min_tradeable_qty) {
      return this.reject(5, qty, `Final qty ${qty} below minimum tradeable ${cfg.min_tradeable_qty}`);
    }

    const verdict = qty < sized.qty ? 'REDUCED_SIZE' : 'APPROVED';

    return {
      passed: true,
      verdict,
      stage: 5,
      reason: ctx.reasons.join('; ') || 'All stages passed',
      adjusted_qty: qty,
      detail: `conviction=${sized.conviction.toFixed(3)} initial_qty=${sized.qty} final_qty=${qty} stages_passed=5`,
    };
  }

  resetForFold(): void {
    this.c.drawdownTracker.resetForFold(0);
  }

  private reject(stage: number, qty: number, reason: string): RiskValidationResult {
    return {
      passed: false,
      verdict: 'REJECTED',
      stage,
      reason,
      adjusted_qty: qty,
      detail: `Rejected at stage ${stage}: ${reason}`,
    };
  }

  private getSpreadPct(symbol_id: string, price: number): number {
    const l1 = this.c.marketDataCache.getL1Snapshot(symbol_id);
    if (!l1 || l1.bid <= 0 || l1.ask <= 0) return 0.05;
    const mid = (l1.bid + l1.ask) / 2;
    return mid > 0 ? ((l1.ask - l1.bid) / mid) * 100 : 0.05;
  }
}
