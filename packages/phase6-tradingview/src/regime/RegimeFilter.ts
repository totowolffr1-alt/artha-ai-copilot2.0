/**
 * packages/phase6-tradingview/src/regime/RegimeFilter.ts
 * Artha AI — Phase 6 Risk Engine — Stage 3
 *
 * Rejects or reduces trades based on market state vs signal direction.
 * - LONG signals in BEAR/CRASH states are hard rejected
 * - LONG signals in HIGH_VOLATILITY get 50% size reduction
 * - CHOPPY/CAUTION regime further reduces by 20%
 */

import { MarketState } from '../types';

export interface RegimeFilterResult {
  passed: boolean;
  size_multiplier: number;
  reject_reason?: string;
  detail: string;
}

export class RegimeFilter {
  filter(direction: 'LONG' | 'SHORT', market_state: MarketState): RegimeFilterResult {
    // Hard block LONG in CRASH
    if (direction === 'LONG' && market_state === 'CRASH') {
      return {
        passed: false,
        size_multiplier: 0,
        reject_reason: 'Long position blocked in CRASH market state',
        detail: `direction=LONG market_state=CRASH → REJECT`,
      };
    }

    // Hard block LONG in BEAR
    if (direction === 'LONG' && market_state === 'BEAR') {
      return {
        passed: false,
        size_multiplier: 0,
        reject_reason: 'Long position blocked in BEAR market state',
        detail: `direction=LONG market_state=BEAR → REJECT`,
      };
    }

    let size_multiplier = 1.0;

    // Size reduction in HIGH_VOLATILITY
    if (market_state === 'HIGH_VOLATILITY') {
      size_multiplier *= 0.50;
    }

    // Partial reduction in CAUTION
    if (market_state === 'CAUTION') {
      size_multiplier *= 0.70;
    }

    return {
      passed: true,
      size_multiplier,
      detail: `direction=${direction} market_state=${market_state} multiplier=${size_multiplier.toFixed(2)}`,
    };
  }
}
