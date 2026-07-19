/**
 * packages/phase6-tradingview/src/drawdown/DrawdownTracker.ts
 * Artha AI — Phase 6 Risk Engine — Stage 2
 *
 * Tracks daily, weekly, monthly, and total drawdowns from high-watermarks.
 * A breach at any horizon → hard REJECT (not reducible).
 *
 * onEquityUpdate() is called by Phase 7/9 on every fill/EOD event.
 * The drawdown state is in-memory — persisted to drawdown_log asynchronously.
 *
 * Zero hot-path I/O on the validate() call.
 */

export interface DrawdownState {
  daily_hwm:   number;
  weekly_hwm:  number;
  monthly_hwm: number;
  total_hwm:   number;
  daily_dd_pct:   number;
  weekly_dd_pct:  number;
  monthly_dd_pct: number;
  total_dd_pct:   number;
  daily_breach:   boolean;
  weekly_breach:  boolean;
  monthly_breach: boolean;
}

export interface DrawdownCheckResult {
  passed: boolean;
  state: DrawdownState;
  breached_horizon?: 'daily' | 'weekly' | 'monthly';
  detail: string;
}

export class DrawdownTracker {
  private daily_hwm   = 0;
  private weekly_hwm  = 0;
  private monthly_hwm = 0;
  private total_hwm   = 0;

  private daily_dd_pct   = 0;
  private weekly_dd_pct  = 0;
  private monthly_dd_pct = 0;
  private total_dd_pct   = 0;

  /**
   * Seed initial equity (start of session / backtest fold).
   */
  initialize(starting_equity: number): void {
    this.daily_hwm = this.weekly_hwm = this.monthly_hwm = this.total_hwm = starting_equity;
    this.daily_dd_pct = this.weekly_dd_pct = this.monthly_dd_pct = this.total_dd_pct = 0;
  }

  /**
   * Update HWMs and compute DD — called on every equity change.
   */
  onEquityUpdate(equity: number): void {
    if (equity > this.daily_hwm)   this.daily_hwm   = equity;
    if (equity > this.weekly_hwm)  this.weekly_hwm  = equity;
    if (equity > this.monthly_hwm) this.monthly_hwm = equity;
    if (equity > this.total_hwm)   this.total_hwm   = equity;

    this.daily_dd_pct   = this.daily_hwm   > 0 ? (this.daily_hwm   - equity) / this.daily_hwm   : 0;
    this.weekly_dd_pct  = this.weekly_hwm  > 0 ? (this.weekly_hwm  - equity) / this.weekly_hwm  : 0;
    this.monthly_dd_pct = this.monthly_hwm > 0 ? (this.monthly_hwm - equity) / this.monthly_hwm : 0;
    this.total_dd_pct   = this.total_hwm   > 0 ? (this.total_hwm   - equity) / this.total_hwm   : 0;
  }

  /**
   * Reset daily HWM at start of each trading session.
   */
  resetDaily(equity: number): void {
    this.daily_hwm   = equity;
    this.daily_dd_pct = 0;
  }

  /**
   * Reset weekly HWM on Monday open.
   */
  resetWeekly(equity: number): void {
    this.weekly_hwm  = equity;
    this.weekly_dd_pct = 0;
  }

  /**
   * Reset monthly HWM on first trading day of month.
   */
  resetMonthly(equity: number): void {
    this.monthly_hwm  = equity;
    this.monthly_dd_pct = 0;
  }

  /**
   * Validate — check if any drawdown limit is breached.
   */
  validate(
    max_daily_dd_pct: number,
    max_weekly_dd_pct: number,
    max_monthly_dd_pct: number,
    dd_limit_multiplier: number,
  ): DrawdownCheckResult {
    const eff_daily   = max_daily_dd_pct   * dd_limit_multiplier;
    const eff_weekly  = max_weekly_dd_pct  * dd_limit_multiplier;
    const eff_monthly = max_monthly_dd_pct * dd_limit_multiplier;

    const state: DrawdownState = {
      daily_hwm:   this.daily_hwm,
      weekly_hwm:  this.weekly_hwm,
      monthly_hwm: this.monthly_hwm,
      total_hwm:   this.total_hwm,
      daily_dd_pct:   this.daily_dd_pct,
      weekly_dd_pct:  this.weekly_dd_pct,
      monthly_dd_pct: this.monthly_dd_pct,
      total_dd_pct:   this.total_dd_pct,
      daily_breach:   this.daily_dd_pct   >= eff_daily,
      weekly_breach:  this.weekly_dd_pct  >= eff_weekly,
      monthly_breach: this.monthly_dd_pct >= eff_monthly,
    };

    if (state.daily_breach) {
      return { passed: false, state, breached_horizon: 'daily', detail: `Daily DD ${(this.daily_dd_pct * 100).toFixed(2)}% ≥ limit ${(eff_daily * 100).toFixed(2)}%` };
    }
    if (state.weekly_breach) {
      return { passed: false, state, breached_horizon: 'weekly', detail: `Weekly DD ${(this.weekly_dd_pct * 100).toFixed(2)}% ≥ limit ${(eff_weekly * 100).toFixed(2)}%` };
    }
    if (state.monthly_breach) {
      return { passed: false, state, breached_horizon: 'monthly', detail: `Monthly DD ${(this.monthly_dd_pct * 100).toFixed(2)}% ≥ limit ${(eff_monthly * 100).toFixed(2)}%` };
    }

    return {
      passed: true,
      state,
      detail: `DD OK: daily=${(this.daily_dd_pct * 100).toFixed(2)}% weekly=${(this.weekly_dd_pct * 100).toFixed(2)}% monthly=${(this.monthly_dd_pct * 100).toFixed(2)}%`,
    };
  }

  getState(): DrawdownState {
    return {
      daily_hwm: this.daily_hwm,
      weekly_hwm: this.weekly_hwm,
      monthly_hwm: this.monthly_hwm,
      total_hwm: this.total_hwm,
      daily_dd_pct: this.daily_dd_pct,
      weekly_dd_pct: this.weekly_dd_pct,
      monthly_dd_pct: this.monthly_dd_pct,
      total_dd_pct: this.total_dd_pct,
      daily_breach: false,
      weekly_breach: false,
      monthly_breach: false,
    };
  }

  resetForFold(equity: number): void {
    this.initialize(equity);
  }
}
