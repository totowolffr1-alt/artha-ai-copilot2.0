/**
 * packages/phase5-strategy/src/indicators/BollingerBands.ts
 * Artha AI — Bollinger Bands
 *
 * Middle Band = SMA(period)         default: 20
 * Upper Band  = SMA + multiplier × σ default: 2.0
 * Lower Band  = SMA − multiplier × σ
 * Bandwidth   = (Upper - Lower) / Middle
 * %B          = (price - Lower) / (Upper - Lower)
 */
export interface BBOutput {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number;
}

export class BollingerBands {
  private readonly window: number[] = [];

  constructor(
    private readonly period = 20,
    private readonly multiplier = 2.0
  ) {}

  next(close: number): BBOutput {
    this.window.push(close);
    if (this.window.length > this.period) this.window.shift();

    if (this.window.length < this.period) {
      return { upper: NaN, middle: NaN, lower: NaN, bandwidth: NaN, percentB: NaN };
    }

    const mean = this.window.reduce((a, b) => a + b, 0) / this.period;
    const variance = this.window.reduce((s, v) => s + (v - mean) ** 2, 0) / this.period;
    const std = Math.sqrt(variance);

    const upper = mean + this.multiplier * std;
    const lower = mean - this.multiplier * std;
    const bandwidth = (upper - lower) / mean;
    const percentB = std === 0 ? 0.5 : (close - lower) / (upper - lower);

    return { upper, middle: mean, lower, bandwidth, percentB };
  }

  reset(): void {
    this.window.length = 0;
  }
}
