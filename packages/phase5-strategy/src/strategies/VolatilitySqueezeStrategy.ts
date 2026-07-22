/**
 * packages/phase5-strategy/src/strategies/VolatilitySqueezeStrategy.ts
 * Artha AI — Volatility Squeeze & Pre-Breakout Strategy
 *
 * Detects low-volatility compression (tight Bollinger Bands) in LOW_VOLATILITY regime
 * and enters aggressively on the first sign of directional breakout.
 */

import { IStrategy, StrategySignal } from './IStrategy';
import { IndicatorSnapshot } from '../indicators/IndicatorPipeline';
import { RegimeClassification } from '../signals/RegimeEngine';

export class VolatilitySqueezeStrategy implements IStrategy {
  readonly name = 'VOLATILITY_SQUEEZE';
  readonly targetRegimes = ['LOW_VOLATILITY'];

  evaluate(
    symbol: string,
    currentPrice: number,
    snap: IndicatorSnapshot,
    regime: RegimeClassification
  ): StrategySignal | null {
    if (regime.label !== 'LOW_VOLATILITY') return null;

    const bbWidthPct = ((snap.bb20.upper - snap.bb20.lower) / snap.bb20.middle) * 100;
    const isSqueezed = bbWidthPct < 2.5; // Very tight bands

    if (!isSqueezed) return null;

    // Upward Squeeze Breakout Bias
    if (currentPrice >= snap.bb20.middle && snap.macd.histogram >= 0) {
      const stopDistance   = snap.atr14 * 1.5;
      const targetDistance = snap.atr14 * 4.0; // High R:R on squeeze breakouts

      return {
        strategyName: this.name,
        symbol,
        direction: 'LONG',
        strength: 'STRONG',
        rawConfidence: 85,
        reason: `Volatility Squeeze (BB Width ${bbWidthPct.toFixed(1)}%): Upward breakout expansion`,
        entryPrice: currentPrice,
        stopLossPrice: currentPrice - stopDistance,
        takeProfitPrice: currentPrice + targetDistance,
      };
    }

    // Downward Squeeze Breakout Bias
    if (currentPrice < snap.bb20.middle && snap.macd.histogram < 0) {
      const stopDistance   = snap.atr14 * 1.5;
      const targetDistance = snap.atr14 * 4.0;

      return {
        strategyName: this.name,
        symbol,
        direction: 'SHORT',
        strength: 'STRONG',
        rawConfidence: 85,
        reason: `Volatility Squeeze (BB Width ${bbWidthPct.toFixed(1)}%): Downward breakout expansion`,
        entryPrice: currentPrice,
        stopLossPrice: currentPrice + stopDistance,
        takeProfitPrice: currentPrice - targetDistance,
      };
    }

    return null;
  }
}
