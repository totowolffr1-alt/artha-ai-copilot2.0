/**
 * packages/phase5-strategy/src/indicators/IndicatorPipeline.ts
 * Artha AI — Indicator Pipeline
 *
 * Feeds each OHLCV bar through all indicators and returns a snapshot.
 * Used by SignalEngine to compute all values in one pass.
 */
import { EMA } from './EMA';
import { RSI } from './RSI';
import { MACD, MACDOutput } from './MACD';
import { ATR } from './ATR';
import { BollingerBands, BBOutput } from './BollingerBands';

export interface IndicatorSnapshot {
  ema20:    number;
  ema50:    number;
  rsi14:    number;
  macd:     MACDOutput;
  atr14:    number;
  bb20:     BBOutput;
}

export class IndicatorPipeline {
  private readonly ema20 = new EMA(20);
  private readonly ema50 = new EMA(50);
  private readonly rsi14 = new RSI(14);
  private readonly macd  = new MACD(12, 26, 9);
  private readonly atr14 = new ATR(14);
  private readonly bb20  = new BollingerBands(20, 2);

  feed(open: number, high: number, low: number, close: number, volume: number): IndicatorSnapshot {
    return {
      ema20: this.ema20.next(close),
      ema50: this.ema50.next(close),
      rsi14: this.rsi14.next(close),
      macd:  this.macd.next(close),
      atr14: this.atr14.next(high, low, close),
      bb20:  this.bb20.next(close),
    };
  }

  reset(): void {
    this.ema20.reset();
    this.ema50.reset();
    this.rsi14.reset();
    this.macd.reset();
    this.atr14.reset();
    this.bb20.reset();
  }
}
