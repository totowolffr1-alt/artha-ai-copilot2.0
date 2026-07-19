/**
 * packages/phase6-tradingview/src/market/vix/VIXAnalyser.ts
 * Artha AI — Phase 6 Risk Engine — Stage 0
 *
 * Converts India VIX level and spike ratio into a volatility score.
 * VIX > 35 triggers an absolute CRASH hard_block.
 */

export interface VIXInputs {
  vix_current: number;
  vix_20d_avg: number;
  extreme_threshold: number;   // from config, default 35.0
  spike_ratio_threshold: number; // from config, default 1.40
}

export interface VIXResult {
  score: number;         // [0, 1] — 0 = calm, 1 = extreme fear
  spike_ratio: number;   // vix_current / vix_20d_avg
  spike_detected: boolean;
  crash_signal: boolean;
  level_tier: 'CALM' | 'ELEVATED' | 'HIGH' | 'EXTREME';
  detail: string;
}

export class VIXAnalyser {
  /**
   * VIX scoring logic:
   *   VIX level tiers (India VIX):
   *     < 14           = CALM       → score 0.0
   *     14 – 18        = ELEVATED   → score 0.25
   *     18 – 25        = HIGH       → score 0.60
   *     25 – 35        = VERY HIGH  → score 0.85
   *     > 35           = EXTREME    → score 1.0 + crash_signal = true
   *
   *   Spike penalty: current / 20d_avg > spike_ratio_threshold adds 0.15.
   */
  analyse(inputs: VIXInputs): VIXResult {
    const { vix_current, vix_20d_avg, extreme_threshold, spike_ratio_threshold } = inputs;

    const crash_signal = vix_current > extreme_threshold;

    const spike_ratio = vix_20d_avg > 0 ? vix_current / vix_20d_avg : 1;
    const spike_detected = spike_ratio > spike_ratio_threshold;

    let level_score: number;
    let level_tier: VIXResult['level_tier'];

    if (vix_current >= extreme_threshold) {
      level_score = 1.0;
      level_tier = 'EXTREME';
    } else if (vix_current >= 25) {
      level_score = 0.85;
      level_tier = 'HIGH';
    } else if (vix_current >= 18) {
      level_score = 0.60;
      level_tier = 'HIGH';
    } else if (vix_current >= 14) {
      level_score = 0.25;
      level_tier = 'ELEVATED';
    } else {
      level_score = 0.0;
      level_tier = 'CALM';
    }

    const spike_bonus = spike_detected ? 0.15 : 0;
    const score = Math.min(1, level_score + spike_bonus);

    const detail = `vix=${vix_current.toFixed(2)} 20d_avg=${vix_20d_avg.toFixed(2)} ratio=${spike_ratio.toFixed(3)} tier=${level_tier} crash=${crash_signal} score=${score.toFixed(3)}`;

    return { score, spike_ratio, spike_detected, crash_signal, level_tier, detail };
  }
}
