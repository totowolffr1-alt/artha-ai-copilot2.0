/**
 * packages/phase5-strategy/src/indicators/EMA.ts
 * Artha AI — Exponential Moving Average
 *
 * Uses standard multiplier: k = 2 / (period + 1)
 * Returns NaN until sufficient bars are fed (warmup = period bars).
 */
export class EMA {
  private value: number = NaN;
  private barCount = 0;
  private readonly k: number;

  constructor(private readonly period: number) {
    if (period < 1) throw new RangeError(`EMA period must be >= 1, got ${period}`);
    this.k = 2 / (period + 1);
  }

  /** Feed the next closing price. Returns current EMA (NaN during warmup). */
  next(price: number): number {
    this.barCount++;
    if (this.barCount === 1) {
      // First bar: seed with price
      this.value = price;
    } else {
      this.value = price * this.k + this.value * (1 - this.k);
    }
    // Return NaN until warmup complete
    return this.barCount >= this.period ? this.value : NaN;
  }

  get current(): number {
    return this.barCount >= this.period ? this.value : NaN;
  }

  reset(): void {
    this.value = NaN;
    this.barCount = 0;
  }
}
