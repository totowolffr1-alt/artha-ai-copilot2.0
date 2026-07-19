/**
 * packages/phase5-strategy/src/indicators/RSI.ts
 * Artha AI — Wilder's Relative Strength Index (RSI)
 *
 * Uses Wilder's smoothing (RMA): avgGain/Loss carry forward each bar.
 * RSI = 100 - (100 / (1 + RS)) where RS = avgGain / avgLoss.
 * Returns NaN during warmup (first `period` bars).
 */
export class RSI {
  private prevClose: number = NaN;
  private avgGain: number = 0;
  private avgLoss: number = 0;
  private barCount = 0;
  private value: number = NaN;

  constructor(private readonly period: number = 14) {
    if (period < 1) throw new RangeError(`RSI period must be >= 1, got ${period}`);
  }

  next(close: number): number {
    if (isNaN(this.prevClose)) {
      this.prevClose = close;
      return NaN;
    }

    const change = close - this.prevClose;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    this.barCount++;

    if (this.barCount <= this.period) {
      // Simple average for first period
      this.avgGain += gain / this.period;
      this.avgLoss += loss / this.period;

      if (this.barCount === this.period) {
        const rs = this.avgLoss === 0 ? Infinity : this.avgGain / this.avgLoss;
        this.value = 100 - 100 / (1 + rs);
      }
    } else {
      // Wilder's smoothing (RMA)
      this.avgGain = (this.avgGain * (this.period - 1) + gain) / this.period;
      this.avgLoss = (this.avgLoss * (this.period - 1) + loss) / this.period;
      const rs = this.avgLoss === 0 ? Infinity : this.avgGain / this.avgLoss;
      this.value = 100 - 100 / (1 + rs);
    }

    this.prevClose = close;
    return this.barCount >= this.period ? this.value : NaN;
  }

  get current(): number { return this.value; }

  reset(): void {
    this.prevClose = NaN;
    this.avgGain = 0;
    this.avgLoss = 0;
    this.barCount = 0;
    this.value = NaN;
  }
}
