/**
 * packages/phase6-tradingview/src/market/indices/BankNiftyTrendAnalyser.ts
 * Artha AI — Phase 6 Risk Engine — Stage 0
 *
 * Analyses BankNifty vs Nifty50 divergence to detect early
 * credit/financial-sector stress signals.
 *
 * Key logic: when BankNifty diverges sharply from Nifty (relative underperformance),
 * it often precedes broader market stress.
 */

export interface BankNiftyTrendInputs {
  banknifty_price: number;
  banknifty_ema20: number;
  banknifty_ema50: number;
  nifty_price: number;
  nifty_ema50: number;
  // 20-day rolling return for divergence calc
  banknifty_return_20d: number;
  nifty_return_20d: number;
  divergence_threshold: number;    // from config, default 0.40
  lag_cap: number;                 // from config, default 0.70
}

export interface BankNiftyTrendResult {
  score: number;          // [-1, 1] — negative = financial stress
  divergence_ratio: number;   // BankNifty 20d return / Nifty 20d return
  divergence_detected: boolean;
  banknifty_below_ema50: boolean;
  detail: string;
}

export class BankNiftyTrendAnalyser {
  /**
   * Divergence detection:
   *   When BankNifty significantly underperforms Nifty on a 20-day rolling basis
   *   (divergence_ratio < divergence_threshold), apply a stress penalty.
   *
   *   divergence_ratio = banknifty_return_20d / nifty_return_20d
   *   (capped at lag_cap to avoid extreme values when Nifty return is tiny)
   */
  analyse(inputs: BankNiftyTrendInputs): BankNiftyTrendResult {
    const {
      banknifty_price, banknifty_ema20, banknifty_ema50,
      nifty_return_20d, banknifty_return_20d,
      divergence_threshold, lag_cap,
    } = inputs;

    const banknifty_below_ema50 = banknifty_price < banknifty_ema50;

    // Safe divergence ratio — avoid div/0 if nifty flat
    let divergence_ratio: number;
    if (Math.abs(nifty_return_20d) < 0.001) {
      // When Nifty is flat, divergence = sign of BankNifty move
      divergence_ratio = banknifty_return_20d >= 0 ? 1 : -1;
    } else {
      divergence_ratio = Math.min(banknifty_return_20d / nifty_return_20d, lag_cap);
    }

    const divergence_detected = divergence_ratio < divergence_threshold;

    // Base score from BankNifty's own EMA position
    const above_ema20 = banknifty_price > banknifty_ema20 ? 0.5 : -0.5;
    const above_ema50 = banknifty_price > banknifty_ema50 ? 0.5 : -0.5;
    let base_score = above_ema20 + above_ema50;  // [-1, 1]

    // Apply divergence penalty
    if (divergence_detected) {
      const penalty = Math.max(-0.5, (divergence_ratio - divergence_threshold) * 0.5);
      base_score += penalty;
    }

    const score = Math.max(-1, Math.min(1, base_score));
    const detail = `divergence_ratio=${divergence_ratio.toFixed(3)} divergence_detected=${divergence_detected} below_ema50=${banknifty_below_ema50} score=${score.toFixed(3)}`;

    return { score, divergence_ratio, divergence_detected, banknifty_below_ema50, detail };
  }
}
