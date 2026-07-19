/**
 * packages/phase6-tradingview/src/regime/NiftyTrendGuard.ts
 * Artha AI — Phase 6 Risk Engine — Stage 3
 *
 * Additional price-vs-EMA200 guard for LONG signals.
 * When Nifty is below its 200-day EMA, adds a structural warning.
 * Not a hard block alone, but combined with other signals can reduce size.
 */

export interface NiftyTrendGuardResult {
  nifty_above_ema200: boolean;
  size_multiplier: number;
  detail: string;
}

export class NiftyTrendGuard {
  check(
    direction: 'LONG' | 'SHORT',
    nifty_price: number,
    nifty_ema200: number,
  ): NiftyTrendGuardResult {
    const nifty_above_ema200 = nifty_price > nifty_ema200;

    // For LONG signals, reduce size when Nifty is below EMA200
    if (direction === 'LONG' && !nifty_above_ema200) {
      const pct_below = nifty_ema200 > 0 ? (nifty_ema200 - nifty_price) / nifty_ema200 : 0;
      const size_multiplier = pct_below > 0.05 ? 0.60 : 0.80;
      return {
        nifty_above_ema200,
        size_multiplier,
        detail: `Nifty below EMA200 by ${(pct_below * 100).toFixed(2)}% → LONG size × ${size_multiplier}`,
      };
    }

    return {
      nifty_above_ema200,
      size_multiplier: 1.0,
      detail: `Nifty ${nifty_above_ema200 ? 'above' : 'below'} EMA200 — no size penalty for ${direction}`,
    };
  }
}
