/**
 * packages/phase6-tradingview/src/monitor/RiskMonitor.ts
 * Artha AI — Phase 6 Risk Engine
 *
 * Read-only monitoring surface for the Risk Engine.
 * Provides snapshots for dashboards and Phase 9 safety layer.
 */

import { IRiskMonitor, RiskSnapshot } from '../contracts/IRiskMonitor';
import { OpenPosition, MarketRiskContext } from '../types';
import { DrawdownTracker } from '../drawdown/DrawdownTracker';
import { CircuitBreaker } from '../breaker/CircuitBreaker';

export class RiskMonitor implements IRiskMonitor {
  private lastSnapshot: RiskSnapshot;
  private lastContext: MarketRiskContext | null = null;

  constructor(
    private readonly drawdownTracker: DrawdownTracker,
    private readonly circuitBreaker: CircuitBreaker,
  ) {
    this.lastSnapshot = this.buildInitialSnapshot();
  }

  getSnapshot(): RiskSnapshot {
    return this.lastSnapshot;
  }

  onEquityUpdate(equity: number, ts: Date): void {
    this.drawdownTracker.onEquityUpdate(equity);
    this.refreshSnapshot(ts);
  }

  onPositionChange(positions: readonly OpenPosition[]): void {
    const total_value = positions.reduce((s, p) => s + p.market_value, 0);
    const long_value  = positions.filter(p => p.direction === 'LONG').reduce((s, p) => s + p.market_value, 0);
    const max_stock   = positions.reduce((max, p) => Math.max(max, p.market_value), 0);

    // Rough snapshot update — full recalculation happens via getSnapshot()
    this.lastSnapshot = {
      ...this.lastSnapshot,
      open_position_count: positions.length,
      net_long_exposure_pct: total_value > 0 ? long_value / total_value : 0,
      largest_stock_exposure_pct: total_value > 0 ? max_stock / total_value : 0,
    };
  }

  updateMarketContext(context: MarketRiskContext): void {
    this.lastContext = context;
    this.refreshSnapshot(context.captured_at);
  }

  private refreshSnapshot(ts: Date): void {
    const ddState = this.drawdownTracker.getState();
    const breakerStatus = this.circuitBreaker.getStatus();
    const ctx = this.lastContext;

    this.lastSnapshot = {
      market_state:              ctx?.market_state ?? 'NEUTRAL',
      risk_budget_multiplier:    ctx?.risk_budget_multiplier ?? 1.0,
      nifty_score:               ctx?.nifty_score ?? 0,
      banknifty_score:           ctx?.banknifty_score ?? 0,
      vix_current:               ctx?.vix_current ?? 0,
      vix_score:                 ctx?.vix_score ?? 0,
      banknifty_divergence:      (ctx?.banknifty_score ?? 0) < -0.30,

      daily_dd_pct:    ddState.daily_dd_pct,
      weekly_dd_pct:   ddState.weekly_dd_pct,
      monthly_dd_pct:  ddState.monthly_dd_pct,
      total_dd_pct:    ddState.total_dd_pct,

      net_long_exposure_pct:          this.lastSnapshot.net_long_exposure_pct,
      largest_stock_exposure_pct:     this.lastSnapshot.largest_stock_exposure_pct,
      largest_sector_exposure_pct:    this.lastSnapshot.largest_sector_exposure_pct,
      portfolio_var_1d_95_pct:        this.lastSnapshot.portfolio_var_1d_95_pct,
      portfolio_heat:                 this.lastSnapshot.portfolio_heat,
      circuit_breaker_state:          breakerStatus.state,
      open_position_count:            this.lastSnapshot.open_position_count,
      timestamp:                      ts,
    };
  }

  private buildInitialSnapshot(): RiskSnapshot {
    return {
      market_state: 'NEUTRAL',
      risk_budget_multiplier: 1.0,
      nifty_score: 0,
      banknifty_score: 0,
      vix_current: 0,
      vix_score: 0,
      banknifty_divergence: false,
      daily_dd_pct: 0,
      weekly_dd_pct: 0,
      monthly_dd_pct: 0,
      total_dd_pct: 0,
      net_long_exposure_pct: 0,
      largest_stock_exposure_pct: 0,
      largest_sector_exposure_pct: 0,
      portfolio_var_1d_95_pct: 0,
      portfolio_heat: 0,
      circuit_breaker_state: 'ARMED',
      open_position_count: 0,
      timestamp: new Date(),
    };
  }
}
