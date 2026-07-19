/**
 * packages/phase6-tradingview/src/volatility/VolatilityAnalyser.ts
 * Artha AI — Phase 6 Risk Engine — Stage 2
 *
 * Validates that a symbol's current volatility is within acceptable bounds.
 * Uses ATR%, HV20, and spike ratio from signal features.
 *
 * If volatility is high but not extreme, reduces qty proportionally.
 * If VIX spike is active, applies additional penalty.
 */

import { VolatilityMetrics } from '../types';

export interface VolatilityCheckInput {
  atr_pct: number;      // ATR as % of price
  hv_20: number;        // 20-day historical volatility (annualised)
  spike_ratio: number;  // current vol / 20d avg vol

  // Thresholds
  max_atr_pct: number;          // e.g. 0.05 (5% ATR cap)
  max_hv_20: number;            // e.g. 0.80 (80% annualised HV cap)
  spike_ratio_cap: number;      // e.g. 2.0
  max_positions: number;        // from context, for regime-aware decisions
}

export interface VolatilityCheckResult {
  passed: boolean;
  size_multiplier: number;   // [0, 1]
  metrics: VolatilityMetrics;
  binding_limit: 'atr' | 'hv20' | 'spike' | 'none';
  detail: string;
}

export class VolatilityAnalyser {
  check(input: VolatilityCheckInput): VolatilityCheckResult {
    const { atr_pct, hv_20, spike_ratio, max_atr_pct, max_hv_20, spike_ratio_cap } = input;

    const metrics: VolatilityMetrics = { atr_pct, hv_20, spike_ratio };

    // Hard reject if ATR% is extreme (> 2× max allowed)
    if (atr_pct > max_atr_pct * 2) {
      return {
        passed: false,
        size_multiplier: 0,
        metrics,
        binding_limit: 'atr',
        detail: `ATR% too high: ${(atr_pct * 100).toFixed(2)}% > ${(max_atr_pct * 200).toFixed(2)}% hard limit`,
      };
    }

    let size_multiplier = 1.0;
    let binding_limit: VolatilityCheckResult['binding_limit'] = 'none';

    // ATR% penalty
    if (atr_pct > max_atr_pct) {
      const penalty = Math.min(0.5, (atr_pct - max_atr_pct) / max_atr_pct);
      size_multiplier *= (1 - penalty);
      binding_limit = 'atr';
    }

    // HV20 penalty
    if (hv_20 > max_hv_20) {
      const penalty = Math.min(0.4, (hv_20 - max_hv_20) / max_hv_20 * 0.5);
      size_multiplier *= (1 - penalty);
      if (binding_limit === 'none') binding_limit = 'hv20';
    }

    // Spike ratio penalty
    if (spike_ratio > spike_ratio_cap) {
      size_multiplier *= 0.75;
      if (binding_limit === 'none') binding_limit = 'spike';
    } else if (spike_ratio > 1.5) {
      size_multiplier *= 0.90;
    }

    size_multiplier = Math.max(0, Math.min(1, size_multiplier));

    const detail = `atr=${(atr_pct * 100).toFixed(2)}% hv20=${(hv_20 * 100).toFixed(1)}% spike=${spike_ratio.toFixed(2)} multiplier=${size_multiplier.toFixed(3)} binding=${binding_limit}`;

    return { passed: true, size_multiplier, metrics, binding_limit, detail };
  }
}
