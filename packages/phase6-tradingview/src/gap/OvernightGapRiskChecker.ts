/**
 * packages/phase6-tradingview/src/gap/OvernightGapRiskChecker.ts
 * Artha AI — Phase 6 Risk Engine — Stage 5
 *
 * Computes overnight gap risk for a swing trade held over N nights.
 *
 * Risk model:
 *   base_gap_risk  = gap_frequency_pct × p95_gap_magnitude_pct × vix_factor × beta
 *   hold_adjusted  = base_gap_risk × (1 - overnight_fraction)^hold_nights
 *   final_score    = weighted(historical_component, p95_component, vix_component)
 *
 * Tiers:
 *   < 0.03  LOW     → no size change
 *   < 0.06  MEDIUM  → size × gap_medium_size_multiplier (default 0.85)
 *   < 0.10  HIGH    → size × gap_high_size_multiplier   (default 0.60)
 *   ≥ 0.10  EXTREME → REJECT
 *
 * Historical gap stats are pre-loaded from the Phase 3 DB at startup.
 * Zero hot-path I/O.
 */

import { OvernightGapMetrics, OvernightGapCheckResult, SwingRiskConfig } from '../types';

export interface GapHistoryRecord {
  symbol_id: string;
  gap_frequency_pct: number;
  median_gap_magnitude_pct: number;
  p95_gap_magnitude_pct: number;
  gap_observations: number;
  beta: number;           // market beta for gap scaling
}

export class OvernightGapRiskChecker {
  private readonly gapHistory: Map<string, GapHistoryRecord> = new Map();

  hydrate(records: GapHistoryRecord[]): void {
    for (const r of records) {
      this.gapHistory.set(r.symbol_id, r);
    }
  }

  check(
    symbol_id: string,
    hold_nights: number,
    vix_current: number,
    cfg: SwingRiskConfig,
  ): OvernightGapCheckResult {
    const hist = this.gapHistory.get(symbol_id);

    // Conservative defaults when no history
    const gap_frequency_pct      = hist?.gap_frequency_pct      ?? 0.15;
    const median_gap_magnitude_pct = hist?.median_gap_magnitude_pct ?? 0.02;
    const p95_gap_magnitude_pct  = hist?.p95_gap_magnitude_pct  ?? 0.05;
    const gap_observations       = hist?.gap_observations       ?? 0;
    const beta                   = hist?.beta                   ?? 1.0;

    // VIX factor: VIX > 25 amplifies gap risk
    const vix_factor =
      vix_current > 35 ? 2.0 :
      vix_current > 25 ? 1.5 :
      vix_current > 18 ? 1.2 : 1.0;

    // Weighted gap risk score components
    const historical_component = gap_frequency_pct * median_gap_magnitude_pct * beta * cfg.gap_weight_historical;
    const p95_component        = p95_gap_magnitude_pct * cfg.gap_weight_p95;
    const vix_component        = (vix_current / 100) * vix_factor * cfg.gap_weight_vix;

    let base_score = historical_component + p95_component + vix_component;

    // Hold duration compounding: each additional night adds risk
    const overnight_risk = base_score * Math.pow(1 + cfg.overnight_fraction, hold_nights - 1);
    const expected_overnight_gap_pct = median_gap_magnitude_pct * vix_factor * beta;

    const gap_risk_score = Math.min(1, overnight_risk);

    // Tier classification
    const risk_tier: OvernightGapMetrics['risk_tier'] =
      gap_risk_score >= 0.10 ? 'EXTREME' :
      gap_risk_score >= 0.06 ? 'HIGH' :
      gap_risk_score >= 0.03 ? 'MEDIUM' : 'LOW';

    const metrics: OvernightGapMetrics = {
      gap_frequency_pct,
      median_gap_magnitude_pct,
      p95_gap_magnitude_pct,
      gap_observations,
      vix_current,
      beta,
      expected_overnight_gap_pct,
      gap_risk_score,
      risk_tier,
    };

    if (risk_tier === 'EXTREME') {
      return {
        passed: false,
        adjusted_qty: 0,
        metrics,
        reason: `Extreme overnight gap risk: score=${gap_risk_score.toFixed(3)}`,
        detail: `hold_nights=${hold_nights} gap_score=${gap_risk_score.toFixed(4)} tier=EXTREME → REJECT`,
      };
    }

    const size_multiplier =
      risk_tier === 'HIGH'   ? cfg.gap_high_size_multiplier :
      risk_tier === 'MEDIUM' ? cfg.gap_medium_size_multiplier : 1.0;

    // adjusted_qty communicated as multiplier; actual qty scaling happens in pipeline
    const detail = `hold_nights=${hold_nights} vix=${vix_current} beta=${beta.toFixed(2)} gap_score=${gap_risk_score.toFixed(4)} tier=${risk_tier} multiplier=${size_multiplier}`;

    return {
      passed: true,
      adjusted_qty: -1,  // Sentinel: actual scaling done by pipeline using size_multiplier field
      metrics,
      detail,
    };
  }
}
