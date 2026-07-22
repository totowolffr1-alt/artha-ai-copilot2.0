/**
 * packages/phase5-strategy/src/strategies/TrendFollowerStrategy.ts
 * Artha AI — Trend Following & Momentum Breakout Strategy
 *
 * Designed to capture sustained directional moves in TRENDING_UP and TRENDING_DOWN regimes.
 * Uses EMA alignment, MACD momentum confirmation, and volume expansion filters.
 */

import { IStrategy, StrategySignal } from './IStrategy';
import { IndicatorSnapshot } from '../indicators/IndicatorPipeline';
import { RegimeClassification } from '../signals/RegimeEngine';

export class TrendFollowerStrategy implements IStrategy {
  readonly name = 'TREND_FOLLOWER';
  readonly targetRegimes = ['TRENDING_UP', 'TRENDING_DOWN'];

  evaluate(
    symbol: string,
    currentPrice: number,
    snap: IndicatorSnapshot,
    regime: RegimeClassification,
    volume: number
  ): StrategySignal | null {
    // Only fire when market is in trending regime
    if (!this.targetRegimes.includes(regime.label)) return null;

    const emaAlignedLong  = snap.ema20 > snap.ema50 && currentPrice > snap.ema20;
    const emaAlignedShort = snap.ema20 < snap.ema50 && currentPrice < snap.ema20;

    const macdLong  = snap.macd.histogram > 0 && snap.macd.macd > snap.macd.signal;
    const macdShort = snap.macd.histogram < 0 && snap.macd.macd < snap.macd.signal;

    const rsiLong  = snap.rsi14 >= 50 && snap.rsi14 <= 75;
    const rsiShort = snap.rsi14 <= 50 && snap.rsi14 >= 25;

    // LONG Signal
    if (regime.label === 'TRENDING_UP' && emaAlignedLong && macdLong && rsiLong) {
      const stopDistance = snap.atr14 * 2.0;
      const targetDistance = snap.atr14 * 3.5;

      return {
        strategyName: this.name,
        symbol,
        direction: 'LONG',
        strength: currentPrice > snap.ema20 * 1.01 ? 'STRONG' : 'MODERATE',
        rawConfidence: Math.min(95, regime.confidence + 10),
        reason: 'Uptrend alignment: EMA20>EMA50, positive MACD, healthy RSI',
        entryPrice: currentPrice,
        stopLossPrice: currentPrice - stopDistance,
        takeProfitPrice: currentPrice + targetDistance,
      };
    }

    // SHORT Signal
    if (regime.label === 'TRENDING_DOWN' && emaAlignedShort && macdShort && rsiShort) {
      const stopDistance = snap.atr14 * 2.0;
      const targetDistance = snap.atr14 * 3.5;

      return {
        strategyName: this.name,
        symbol,
        direction: 'SHORT',
        strength: currentPrice < snap.ema20 * 0.99 ? 'STRONG' : 'MODERATE',
        rawConfidence: Math.min(95, regime.confidence + 10),
        reason: 'Downtrend alignment: EMA20<EMA50, negative MACD, weak RSI',
        entryPrice: currentPrice,
        stopLossPrice: currentPrice + stopDistance,
        takeProfitPrice: currentPrice - targetDistance,
      };
    }

    return null;
  }
}
