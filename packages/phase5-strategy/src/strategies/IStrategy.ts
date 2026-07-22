/**
 * packages/phase5-strategy/src/strategies/IStrategy.ts
 * Artha AI — Common Strategy Interface
 */

import { IndicatorSnapshot } from '../indicators/IndicatorPipeline';
import { RegimeClassification } from '../signals/RegimeEngine';
import { SignalDirection, SignalStrength } from '../signals/SignalEvent';

export interface StrategySignal {
  strategyName: string;
  symbol: string;
  direction: SignalDirection;
  strength: SignalStrength;
  rawConfidence: number; // 0–100
  reason: string;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
}

export interface IStrategy {
  readonly name: string;
  readonly targetRegimes: string[];

  evaluate(
    symbol: string,
    currentPrice: number,
    snapshot: IndicatorSnapshot,
    regime: RegimeClassification,
    volume: number,
    prevClose?: number
  ): StrategySignal | null;
}
