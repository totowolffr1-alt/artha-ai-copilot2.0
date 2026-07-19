/**
 * packages/phase6-tradingview/src/market/MarketRiskEngine.ts
 * Artha AI — Phase 6 Risk Engine — Stage 0 Orchestrator
 *
 * Composes NiftyTrendAnalyser, BankNiftyTrendAnalyser, VIXAnalyser,
 * and MarketRegimeAggregator into the full Stage 0 output.
 *
 * The result is cached for `market_context_refresh_interval_minutes`
 * so the hot path never runs index analysis per-signal.
 */

import { MarketRiskContext, MarketRiskConfig } from '../types';
import { NiftyTrendAnalyser, NiftyTrendInputs } from './indices/NiftyTrendAnalyser';
import { BankNiftyTrendAnalyser, BankNiftyTrendInputs } from './indices/BankNiftyTrendAnalyser';
import { VIXAnalyser, VIXInputs } from './vix/VIXAnalyser';
import { MarketRegimeAggregator } from './regime/MarketRegimeAggregator';

export interface MarketRiskEngineInputs {
  // Nifty50
  nifty_price: number;
  nifty_ema20: number;
  nifty_ema50: number;
  nifty_ema200: number;
  nifty_peak_52w: number;
  // BankNifty
  banknifty_price: number;
  banknifty_ema20: number;
  banknifty_ema50: number;
  banknifty_return_20d: number;
  nifty_return_20d: number;
  // VIX
  vix_current: number;
  vix_20d_avg: number;
  // Signal regime context
  regime_label: string;
}

export class MarketRiskEngine {
  private readonly niftyAnalyser   = new NiftyTrendAnalyser();
  private readonly bankNiftyAnalyser = new BankNiftyTrendAnalyser();
  private readonly vixAnalyser      = new VIXAnalyser();
  private readonly aggregator       = new MarketRegimeAggregator();

  // In-memory cache
  private _cached: MarketRiskContext | null = null;
  private _cachedAt: number = 0;  // epoch ms

  constructor(private readonly cfg: MarketRiskConfig) {}

  /**
   * Returns the cached MarketRiskContext if fresh, otherwise recomputes.
   */
  getContext(inputs: MarketRiskEngineInputs, now: Date = new Date()): MarketRiskContext {
    const cacheTtlMs = this.cfg.market_context_refresh_interval_minutes * 60 * 1000;
    if (this._cached && (now.getTime() - this._cachedAt) < cacheTtlMs) {
      return this._cached;
    }
    return this.compute(inputs, now);
  }

  /**
   * Force recompute regardless of cache TTL.
   */
  compute(inputs: MarketRiskEngineInputs, now: Date = new Date()): MarketRiskContext {
    const niftyInputs: NiftyTrendInputs = {
      price:      inputs.nifty_price,
      ema20:      inputs.nifty_ema20,
      ema50:      inputs.nifty_ema50,
      ema200:     inputs.nifty_ema200,
      peak_52w:   inputs.nifty_peak_52w,
    };

    const bankNiftyInputs: BankNiftyTrendInputs = {
      banknifty_price:       inputs.banknifty_price,
      banknifty_ema20:       inputs.banknifty_ema20,
      banknifty_ema50:       inputs.banknifty_ema50,
      nifty_price:           inputs.nifty_price,
      nifty_ema50:           inputs.nifty_ema50,
      banknifty_return_20d:  inputs.banknifty_return_20d,
      nifty_return_20d:      inputs.nifty_return_20d,
      divergence_threshold:  this.cfg.banknifty_divergence_threshold,
      lag_cap:               this.cfg.banknifty_lag_cap,
    };

    const vixInputs: VIXInputs = {
      vix_current:            inputs.vix_current,
      vix_20d_avg:            inputs.vix_20d_avg,
      extreme_threshold:      this.cfg.vix_extreme_threshold,
      spike_ratio_threshold:  this.cfg.vix_spike_ratio_threshold,
    };

    const niftyResult     = this.niftyAnalyser.analyse(niftyInputs);
    const bankNiftyResult = this.bankNiftyAnalyser.analyse(bankNiftyInputs);
    const vixResult       = this.vixAnalyser.analyse(vixInputs);

    const context = this.aggregator.aggregate({
      nifty_score:              niftyResult.score,
      banknifty_score:          bankNiftyResult.score,
      vix_score:                vixResult.score,
      regime_label:             inputs.regime_label,
      vix_crash:                vixResult.crash_signal,
      nifty_dd_from_peak_pct:   niftyResult.dd_from_peak_pct,
      banknifty_divergence:     bankNiftyResult.divergence_detected,

      // Raw for audit
      nifty_price:        inputs.nifty_price,
      nifty_ema20:        inputs.nifty_ema20,
      nifty_ema50:        inputs.nifty_ema50,
      nifty_ema200:       inputs.nifty_ema200,
      banknifty_price:    inputs.banknifty_price,
      banknifty_ema20:    inputs.banknifty_ema20,
      vix_current:        inputs.vix_current,
      vix_20d_avg:        inputs.vix_20d_avg,
    }, this.cfg, now);

    this._cached   = context;
    this._cachedAt = now.getTime();

    return context;
  }

  /**
   * Invalidate cache (e.g. after VIX spike detected by market data feed).
   */
  invalidateCache(): void {
    this._cached   = null;
    this._cachedAt = 0;
  }
}
