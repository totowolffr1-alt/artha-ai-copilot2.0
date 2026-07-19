/**
 * packages/phase5-strategy/src/indicators/MACD.ts
 * Artha AI — MACD (Moving Average Convergence/Divergence)
 *
 * MACD Line    = EMA(fast) - EMA(slow)   default: 12, 26
 * Signal Line  = EMA(macdLine, signal)   default: 9
 * Histogram    = MACD Line - Signal Line
 * Returns NaN during warmup.
 */
import { EMA } from './EMA';

export interface MACDOutput {
  macd: number;
  signal: number;
  histogram: number;
}

export class MACD {
  private readonly fastEMA: EMA;
  private readonly slowEMA: EMA;
  private readonly signalEMA: EMA;

  constructor(
    private readonly fastPeriod = 12,
    private readonly slowPeriod = 26,
    private readonly signalPeriod = 9
  ) {
    this.fastEMA = new EMA(fastPeriod);
    this.slowEMA = new EMA(slowPeriod);
    this.signalEMA = new EMA(signalPeriod);
  }

  next(close: number): MACDOutput {
    const fast = this.fastEMA.next(close);
    const slow = this.slowEMA.next(close);

    if (isNaN(fast) || isNaN(slow)) {
      return { macd: NaN, signal: NaN, histogram: NaN };
    }

    const macdLine = fast - slow;
    const signalLine = this.signalEMA.next(macdLine);

    if (isNaN(signalLine)) {
      return { macd: macdLine, signal: NaN, histogram: NaN };
    }

    return {
      macd: macdLine,
      signal: signalLine,
      histogram: macdLine - signalLine,
    };
  }

  reset(): void {
    this.fastEMA.reset();
    this.slowEMA.reset();
    this.signalEMA.reset();
  }
}
