/**
 * packages/phase7-broker/src/protection/SmartTrailingStop.ts
 * Artha AI — Phase 7 Capital Protection — Smart Trailing Stop-Loss
 *
 * Automatically tracks High-Water Marks (HWM) or Low-Water Marks (LWM)
 * and trailing stop values adjusted for ATR volatility and market regime.
 */

import { TrailingStopState } from '../types/domain';

export interface TSLUpdateInput {
  direction: 'LONG' | 'SHORT';
  current_price: number;
  atr: number;
  market_state: string;

  // Trailing stop state
  state: TrailingStopState;
}

export class SmartTrailingStop {
  /**
   * Determine trailing multiplier K based on market state:
   *   - STRONG_BULL (Longs): K = 2.2 (gives trend room)
   *   - NEUTRAL / CAUTION: K = 1.3 (tight trail to lock in gains early)
   *   - HIGH_VOLATILITY: K = 2.8 (widened to avoid noise stops)
   *   - Default: K = 1.8
   */
  getMultiplier(market_state: string): number {
    const state = market_state.toUpperCase();
    if (state === 'STRONG_BULL' || state === 'STRONG_TREND') return 2.2;
    if (state === 'NEUTRAL' || state === 'CAUTION' || state === 'CHOPPY') return 1.3;
    if (state === 'HIGH_VOLATILITY' || state === 'CRASH') return 2.8;
    return 1.8;
  }

  /**
   * Update trailing stop-loss level.
   * SL only ever moves in the direction of the trade (up for LONG, down for SHORT).
   */
  update(input: TSLUpdateInput): TrailingStopState {
    const { direction, current_price, atr, market_state, state } = input;
    const K = this.getMultiplier(market_state);

    if (direction === 'LONG') {
      const new_hwm = Math.max(state.hwm_price, current_price);
      // Trailing stop is K × ATR below the HWM
      const target_stop = new_hwm - atr * K;
      // Stop price can only rise, never fall
      const new_stop = Math.max(state.current_stop_price, target_stop);

      return {
        hwm_price: new_hwm,
        current_stop_price: new_stop,
        K_multiplier: K,
      };
    } else {
      // For SHORT, hwm_price represents the LWM (Low-Water Mark)
      const new_lwm = state.hwm_price === 0 ? current_price : Math.min(state.hwm_price, current_price);
      // Trailing stop is K × ATR above the LWM
      const target_stop = new_lwm + atr * K;
      // Stop price can only fall, never rise
      const new_stop = state.current_stop_price === 0
        ? target_stop
        : Math.min(state.current_stop_price, target_stop);

      return {
        hwm_price: new_lwm,
        current_stop_price: new_stop,
        K_multiplier: K,
      };
    }
  }
}
