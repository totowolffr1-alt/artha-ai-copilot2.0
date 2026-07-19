/**
 * packages/phase5-strategy/src/indicators/ATR.ts
 * Artha AI — Average True Range (Wilder Smoothing)
 *
 * True Range = max(high-low, |high-prevClose|, |low-prevClose|)
 * ATR = Wilder smoothed average of TR over `period` bars.
 * Returns NaN during warmup.
 */
export class ATR {
  private prevClose: number = NaN;
  private atr: number = NaN;
  private barCount = 0;

  constructor(private readonly period: number = 14) {
    if (period < 1) throw new RangeError(`ATR period must be >= 1, got ${period}`);
  }

  next(high: number, low: number, close: number): number {
    let tr: number;
    if (isNaN(this.prevClose)) {
      tr = high - low;
    } else {
      tr = Math.max(
        high - low,
        Math.abs(high - this.prevClose),
        Math.abs(low - this.prevClose)
      );
    }

    this.barCount++;

    if (this.barCount <= this.period) {
      // First period: simple cumulative average
      this.atr = isNaN(this.atr) ? tr : this.atr + tr;
      if (this.barCount === this.period) {
        this.atr = this.atr / this.period;
      }
    } else {
      // Wilder smoothing
      this.atr = (this.atr * (this.period - 1) + tr) / this.period;
    }

    this.prevClose = close;
    return this.barCount >= this.period ? this.atr : NaN;
  }

  get current(): number { return this.atr; }

  reset(): void {
    this.prevClose = NaN;
    this.atr = NaN;
    this.barCount = 0;
  }
}
