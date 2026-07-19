/**
 * packages/phase6-tradingview/src/market/indices/NiftyTrendAnalyser.ts
 * Artha AI — Phase 6 Risk Engine — Stage 0
 *
 * Computes a Nifty50 trend score ∈ [-1, 1] from EMA20/50/200 alignment,
 * price-vs-EMA distances, and daily drawdown from peak.
 *
 * Zero hot-path I/O — all inputs come from the pre-warmed MarketDataCache.
 */

export interface NiftyTrendInputs {
  price: number;
  ema20: number;
  ema50: number;
  ema200: number;
  peak_52w: number;  // 52-week high, used for drawdown calculation
}

export interface NiftyTrendResult {
  score: number;        // [-1, 1]: -1 = strong bearish, +1 = strong bullish
  alignment: 'bull_full' | 'bull_partial' | 'neutral' | 'bear_partial' | 'bear_full';
  dd_from_peak_pct: number;    // % drawdown from 52-week high
  price_vs_ema200_pct: number; // % distance from EMA200
  detail: string;
}

export class NiftyTrendAnalyser {
  /**
   * Compute trend score from EMA alignment:
   *   bull_full:    price > ema20 > ema50 > ema200  → score near +1
   *   bull_partial: price > ema50 > ema200 (ema20 lagging) → score near +0.5
   *   neutral:      mixed signals → score near 0
   *   bear_partial: price < ema50 < ema200 (ema20 leading down) → score near -0.5
   *   bear_full:    price < ema20 < ema50 < ema200 → score near -1
   */
  analyse(inputs: NiftyTrendInputs): NiftyTrendResult {
    const { price, ema20, ema50, ema200, peak_52w } = inputs;

    const dd_from_peak_pct = peak_52w > 0 ? (peak_52w - price) / peak_52w : 0;
    const price_vs_ema200_pct = ema200 > 0 ? (price - ema200) / ema200 : 0;

    // EMA alignment score components
    const above_ema20  = price > ema20  ? 1 : 0;
    const above_ema50  = price > ema50  ? 1 : 0;
    const above_ema200 = price > ema200 ? 1 : 0;
    const ema20_above_ema50  = ema20 > ema50  ? 1 : 0;
    const ema50_above_ema200 = ema50 > ema200 ? 1 : 0;

    // 5-component bull score (each contributes 0.2)
    const raw_score =
      above_ema20 * 0.20 +
      above_ema50 * 0.25 +
      above_ema200 * 0.25 +
      ema20_above_ema50 * 0.15 +
      ema50_above_ema200 * 0.15;

    // Map [0, 1] → [-1, 1]
    const base_score = raw_score * 2 - 1;

    // Penalise for deep drawdowns from 52-week high
    const dd_penalty = dd_from_peak_pct > 0.15 ? -0.30
                     : dd_from_peak_pct > 0.10 ? -0.15
                     : dd_from_peak_pct > 0.07 ? -0.05
                     : 0;

    const score = Math.max(-1, Math.min(1, base_score + dd_penalty));

    let alignment: NiftyTrendResult['alignment'];
    if (above_ema20 && above_ema50 && above_ema200 && ema20_above_ema50 && ema50_above_ema200) {
      alignment = 'bull_full';
    } else if (above_ema200 && above_ema50) {
      alignment = 'bull_partial';
    } else if (!above_ema200 && !above_ema50 && !ema20_above_ema50 && !ema50_above_ema200) {
      alignment = 'bear_full';
    } else if (!above_ema200 && !above_ema50) {
      alignment = 'bear_partial';
    } else {
      alignment = 'neutral';
    }

    const detail = `alignment=${alignment} price_vs_ema200=${(price_vs_ema200_pct * 100).toFixed(2)}% dd_from_peak=${(dd_from_peak_pct * 100).toFixed(2)}% score=${score.toFixed(3)}`;

    return { score, alignment, dd_from_peak_pct, price_vs_ema200_pct, detail };
  }
}
