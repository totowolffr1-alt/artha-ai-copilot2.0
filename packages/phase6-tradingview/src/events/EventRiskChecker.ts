/**
 * packages/phase6-tradingview/src/events/EventRiskChecker.ts
 * Artha AI — Phase 6 Risk Engine — Stage 5
 *
 * Evaluates corporate event risk based on upcoming earnings/dividends
 * and historical earnings gap sizes.
 *
 * Gap risk tiers:
 *   LOW     — < 3% historical median gap
 *   MEDIUM  — 3–6%  → size × 0.85
 *   HIGH    — 6–10% → size × 0.60
 *   EXTREME — > 10% → REJECT
 *
 * Historical gap data is pre-loaded from Phase 3 corporate_events table.
 */

import { SwingRiskConfig } from '../types';

export type EarningsGapTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export interface UpcomingEvent {
  event_type: 'EARNINGS' | 'DIVIDEND' | 'BONUS' | 'SPLIT' | 'AGM' | 'EGM';
  days_until: number;       // calendar days until event
  gap_pct_estimate: number | null;  // historical median gap %, null = no data
}

export interface EventRiskResult {
  passed: boolean;
  size_multiplier: number;
  gap_tier: EarningsGapTier;
  upcoming_events: UpcomingEvent[];
  reject_reason?: string;
  detail: string;
}

export class EventRiskChecker {
  /**
   * Checks for corporate events in the holding window.
   * @param symbol_id - Symbol identifier
   * @param upcoming_events - Pre-loaded events from corporate_events table
   * @param hold_days - Expected hold duration in trading days
   * @param cfg - Swing risk configuration
   */
  check(
    symbol_id: string,
    upcoming_events: UpcomingEvent[],
    hold_days: number,
    cfg: SwingRiskConfig,
  ): EventRiskResult {
    // Filter to events within hold window
    const relevant_events = upcoming_events.filter(e => e.days_until <= hold_days * 1.5);

    if (relevant_events.length === 0) {
      return {
        passed: true,
        size_multiplier: 1.0,
        gap_tier: 'LOW',
        upcoming_events,
        detail: 'No corporate events in hold window',
      };
    }

    // Find worst earnings gap in the window
    const earnings_events = relevant_events.filter(e => e.event_type === 'EARNINGS');
    let worst_gap_pct = 0;

    for (const e of earnings_events) {
      const gap = e.gap_pct_estimate ?? 0;
      if (Math.abs(gap) > Math.abs(worst_gap_pct)) {
        worst_gap_pct = gap;
      }
    }

    // Tier classification
    const abs_gap = Math.abs(worst_gap_pct);
    let gap_tier: EarningsGapTier;
    let size_multiplier: number;

    if (abs_gap >= cfg.earnings_gap_high_threshold_pct) {
      gap_tier = 'EXTREME';
      size_multiplier = 0;
    } else if (abs_gap >= cfg.earnings_gap_medium_threshold_pct) {
      gap_tier = 'HIGH';
      size_multiplier = cfg.gap_high_size_multiplier;
    } else if (abs_gap >= cfg.earnings_gap_low_threshold_pct) {
      gap_tier = 'MEDIUM';
      size_multiplier = cfg.gap_medium_size_multiplier;
    } else {
      gap_tier = 'LOW';
      size_multiplier = 1.0;
    }

    // Dividend events within 2 days → reduce
    const imminent_dividend = relevant_events.some(
      e => e.event_type === 'DIVIDEND' && e.days_until <= 2
    );
    if (imminent_dividend) {
      size_multiplier = Math.min(size_multiplier, 0.70);
    }

    const passed = gap_tier !== 'EXTREME';
    const reject_reason = gap_tier === 'EXTREME'
      ? `Extreme earnings gap risk: ${worst_gap_pct.toFixed(1)}% historical gap`
      : undefined;

    const detail = `events=${relevant_events.length} worst_gap=${worst_gap_pct.toFixed(1)}% tier=${gap_tier} multiplier=${size_multiplier}`;

    return { passed, size_multiplier, gap_tier, upcoming_events: relevant_events, reject_reason, detail };
  }
}
