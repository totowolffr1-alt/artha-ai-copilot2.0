/**
 * packages/phase6-tradingview/src/contracts/IRiskMonitor.ts
 * Artha AI — Phase 6 Risk Engine
 */

import { MarketState, OpenPosition } from '../types';

export interface RiskSnapshot {
  readonly market_state: MarketState;
  readonly risk_budget_multiplier: number;
  readonly nifty_score: number;
  readonly banknifty_score: number;
  readonly vix_current: number;
  readonly vix_score: number;
  readonly banknifty_divergence: boolean;

  readonly daily_dd_pct: number;
  readonly weekly_dd_pct: number;
  readonly monthly_dd_pct: number;
  readonly total_dd_pct: number;

  readonly net_long_exposure_pct: number;
  readonly largest_stock_exposure_pct: number;
  readonly largest_sector_exposure_pct: number;
  readonly portfolio_var_1d_95_pct: number;
  readonly portfolio_heat: number;
  readonly circuit_breaker_state: string;
  readonly open_position_count: number;
  readonly timestamp: Date;
}

export interface IRiskMonitor {
  /**
   * Fetch a read-only audit snapshot of the current Risk Engine state.
   */
  getSnapshot(): RiskSnapshot;

  /**
   * Log an equity update to trace drawdowns.
   */
  onEquityUpdate(equity: number, ts: Date): void;

  /**
   * Log position transitions to trace exposure levels.
   */
  onPositionChange(positions: readonly OpenPosition[]): void;
}
