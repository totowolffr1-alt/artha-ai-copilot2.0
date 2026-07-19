/**
 * packages/phase6-tradingview/src/market/regime/MarketRegimeAggregator.ts
 * Artha AI — Phase 6 Risk Engine — Stage 0
 *
 * Combines Nifty trend score, BankNifty score, VIX score, and
 * the signal's own regime label into a final MarketState and
 * risk budget multipliers.
 *
 * Weight vector (from config defaults):
 *   nifty:      0.35
 *   banknifty:  0.25
 *   regime:     0.25
 *   vix:        0.15
 */

import { MarketState, MarketRiskContext, MarketRiskConfig } from '../../types';

export interface AggregatorInputs {
  nifty_score: number;            // [-1, 1]
  banknifty_score: number;        // [-1, 1]
  vix_score: number;              // [0, 1]  (0=calm, 1=panic)
  regime_label: string;           // e.g. 'trending_up', 'trending_down', 'choppy'
  vix_crash: boolean;
  nifty_dd_from_peak_pct: number;
  banknifty_divergence: boolean;

  // Raw values for audit
  nifty_price: number;
  nifty_ema20: number;
  nifty_ema50: number;
  nifty_ema200: number;
  banknifty_price: number;
  banknifty_ema20: number;
  vix_current: number;
  vix_20d_avg: number;
}

function regimeToScore(regime: string): number {
  switch (regime.toLowerCase()) {
    case 'trending_up':    return  0.80;
    case 'strong_trend':   return  1.00;
    case 'trending_down':  return -0.80;
    case 'choppy':         return  0.00;
    case 'high_volatility':return -0.30;
    case 'ranging':        return  0.10;
    default:               return  0.00;
  }
}

function stateToMultiplier(state: MarketState, cfg: MarketRiskConfig): number {
  switch (state) {
    case 'STRONG_BULL':      return cfg.multiplier_strong_bull;
    case 'BULL':             return cfg.multiplier_bull;
    case 'NEUTRAL':          return cfg.multiplier_neutral;
    case 'CAUTION':          return cfg.multiplier_caution;
    case 'BEAR':             return cfg.multiplier_bear;
    case 'HIGH_VOLATILITY':  return cfg.multiplier_high_volatility;
    case 'CRASH':            return 0;
  }
}

export class MarketRegimeAggregator {
  aggregate(inputs: AggregatorInputs, cfg: MarketRiskConfig, capturedAt: Date): MarketRiskContext {
    // Hard block on VIX crash
    if (inputs.vix_crash) {
      return this.buildContext(inputs, 'CRASH', cfg, capturedAt, true, `India VIX above ${cfg.vix_extreme_threshold}`);
    }

    // Hard block on deep Nifty drawdown from peak
    if (inputs.nifty_dd_from_peak_pct >= cfg.crash_nifty_dd_threshold) {
      return this.buildContext(inputs, 'CRASH', cfg, capturedAt, true, `Nifty down ${(inputs.nifty_dd_from_peak_pct * 100).toFixed(1)}% from 52w high`);
    }

    const regime_score = regimeToScore(inputs.regime_label);

    // Vix score inverted: high vix score = negative market direction
    const vix_directional = -inputs.vix_score;

    const composite =
      inputs.nifty_score    * cfg.weight_nifty +
      inputs.banknifty_score * cfg.weight_banknifty +
      regime_score          * cfg.weight_regime +
      vix_directional       * cfg.weight_vix;

    // Determine state from composite score
    let state: MarketState;
    if (composite >=  0.70) state = 'STRONG_BULL';
    else if (composite >= 0.35) state = 'BULL';
    else if (composite >= 0.05) state = 'NEUTRAL';
    else if (composite >= -0.20) state = 'CAUTION';
    else if (composite >= -0.50) state = 'BEAR';
    else state = 'CRASH';

    // Upgrade to HIGH_VOLATILITY if VIX spike detected even in BULL/NEUTRAL
    if (inputs.vix_score >= 0.60 && (state === 'BULL' || state === 'NEUTRAL' || state === 'STRONG_BULL')) {
      state = 'HIGH_VOLATILITY';
    }

    return this.buildContext(inputs, state, cfg, capturedAt, false);
  }

  private buildContext(
    inputs: AggregatorInputs,
    state: MarketState,
    cfg: MarketRiskConfig,
    capturedAt: Date,
    hard_block: boolean,
    hard_block_reason?: string,
  ): MarketRiskContext {
    const multiplier = stateToMultiplier(state, cfg);
    const regime_score = regimeToScore(inputs.regime_label);

    const max_positions_map: Record<MarketState, number> = {
      STRONG_BULL: 10,
      BULL: 8,
      NEUTRAL: 6,
      CAUTION: 4,
      BEAR: 2,
      HIGH_VOLATILITY: 4,
      CRASH: 0,
    };

    return {
      market_state: state,
      hard_block,
      hard_block_reason,
      risk_budget_multiplier: multiplier,
      var_limit_multiplier: multiplier,
      dd_limit_multiplier: multiplier,
      max_positions_override: max_positions_map[state],
      nifty_score: inputs.nifty_score,
      banknifty_score: inputs.banknifty_score,
      vix_score: inputs.vix_score,
      regime_score,
      nifty_price: inputs.nifty_price,
      nifty_ema20: inputs.nifty_ema20,
      nifty_ema50: inputs.nifty_ema50,
      nifty_ema200: inputs.nifty_ema200,
      banknifty_price: inputs.banknifty_price,
      banknifty_ema20: inputs.banknifty_ema20,
      vix_current: inputs.vix_current,
      vix_20d_avg: inputs.vix_20d_avg,
      captured_at: capturedAt,
    };
  }
}
