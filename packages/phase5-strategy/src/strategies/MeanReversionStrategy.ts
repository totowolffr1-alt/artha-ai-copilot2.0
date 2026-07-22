/**
 * packages/phase5-strategy/src/strategies/MeanReversionStrategy.ts
 * Artha AI — Mean Reversion Strategy
 *
 * Designed to profit from range-bound markets (SIDEWAYS regime).
 * Buys oversold dips near lower Bollinger Band and sells overbought rallies near upper Bollinger Band.
 */

import { IStrategy, StrategySignal } from './IStrategy';
import { IndicatorSnapshot } from '../indicators/IndicatorPipeline';
import { RegimeClassification } from '../signals/RegimeEngine';

export class MeanReversionStrategy implements IStrategy {
  readonly name = 'MEAN_REVERSION';
  readonly targetRegimes = ['SIDEWAYS', 'HIGH_VOLATILITY'];

  evaluate(
    symbol: string,
    currentPrice: number,
    snap: IndicatorSnapshot,
    regime: RegimeClassification
  ): StrategySignal | null {
    if (!this.targetRegimes.includes(regime.label)) return null;

    const nearLowerBB = currentPrice <= snap.bb20.lower * 1.005;
    const nearUpperBB = currentPrice >= snap.bb20.upper * 0.995;

    const rsiOversold  = snap.rsi14 <= 38;
    const rsiOverbought = snap.rsi14 >= 62;

    // Mean Reversion LONG (Buy at range bottom)
    if (nearLowerBB && rsiOversold) {
      const stopDistance   = snap.atr14 * 1.5;
      const targetDistance = Math.abs(snap.bb20.middle - currentPrice);

      return {
        strategyName: this.name,
        symbol,
        direction: 'LONG',
        strength: 'MODERATE',
        rawConfidence: 80,
        reason: 'Mean Reversion: Price near lower Bollinger Band with oversold RSI',
        entryPrice: currentPrice,
        stopLossPrice: currentPrice - stopDistance,
        takeProfitPrice: currentPrice + Math.max(targetDistance, snap.atr14 * 2.0),
      };
    }

    // Mean Reversion SHORT (Sell at range top)
    if (nearUpperBB && rsiOverbought) {
      const stopDistance   = snap.atr14 * 1.5;
      const targetDistance = Math.abs(currentPrice - snap.bb20.middle);

      return {
        strategyName: this.name,
        symbol,
        direction: 'SHORT',
        strength: 'MODERATE',
        rawConfidence: 80,
        reason: 'Mean Reversion: Price near upper Bollinger Band with overbought RSI',
        entryPrice: currentPrice,
        stopLossPrice: currentPrice + stopDistance,
        takeProfitPrice: currentPrice - Math.max(targetDistance, snap.atr14 * 2.0),
      };
    }

    return null;
  }
}
