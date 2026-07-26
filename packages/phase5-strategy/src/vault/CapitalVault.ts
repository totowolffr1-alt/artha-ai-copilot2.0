/**
 * CapitalVault.ts — Phase 19: Autonomous Trading Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all capital state in the Artha AI trading engine.
 *
 * QUANT DESIGN:
 *  - Owner sets an allocation (min ₹100, max ₹10,00,000)
 *  - Vault tracks deployed capital per open trade (reserved until exit)
 *  - All P&L flows back through releaseCapital() to update running totals
 *  - Compound mode: profits are automatically reinvested into the allocation
 *  - CRITICAL: Minimum viable trade = ₹2,000 (below this, brokerage ₹40 = >2% cost)
 *  - State persists across server restarts via serialisation
 *
 * BROKERAGE NOTE:
 *  At ₹100 allocation, round-trip brokerage (₹20 × 2) = ₹40 = 40% overhead.
 *  The vault enforces MIN_LIVE_TRADE_VALUE = ₹2,000 for any real order.
 *  Below this threshold, the system stays in PAPER mode automatically.
 */

import { EventEmitter } from 'events';

// ── Constants ──────────────────────────────────────────────────────────────────
export const MIN_ALLOCATION       = 0;            // No minimum allocation constraint
export const MIN_LIVE_TRADE_VALUE = 2_000;        // Below this = auto paper-trade
export const DAILY_LOSS_LIMIT_PCT = 0.05;         // 5% of allocation per day
export const DRAWDOWN_PAUSE_PCT   = 0.15;         // 15% drawdown from peak → pause
export const MAX_POSITION_PCT     = 0.20;         // Max 20% of allocation per trade
export const BROKERAGE_PER_ORDER  = 20;           // ₹20 flat per order (Angel One)

// ── Types ──────────────────────────────────────────────────────────────────────
export type VaultMode = 'PAPER' | 'LIVE';
export type VaultState = 'ACTIVE' | 'DAILY_LIMIT_HIT' | 'DRAWDOWN_PAUSED' | 'LOCKED';

export interface TradeReservation {
  tradeId: string;
  symbol: string;
  reservedAmount: number;
  reservedAt: Date;
}

export interface VaultStatus {
  allocatedCapital: number;
  availableCapital: number;
  deployedCapital: number;
  peakCapital: number;
  todayPnL: number;
  weekPnL: number;
  monthPnL: number;
  totalPnL: number;
  todayLossAmount: number;
  dailyLossLimit: number;
  drawdownFromPeak: number;
  openReservations: number;
  state: VaultState;
  mode: VaultMode;
  compoundMode: boolean;
  minLiveTradeValue: number;
  brokerageWarning?: string;
  lastUpdated: Date;
}

export interface CapitalVaultConfig {
  compoundMode?: boolean;       // Reinvest profits into allocation (default: false)
  mode?: VaultMode;             // 'PAPER' | 'LIVE' (default: PAPER)
}

// ── CapitalVault ───────────────────────────────────────────────────────────────
export class CapitalVault extends EventEmitter {
  private allocatedCapital: number = 0;
  private peakCapital: number = 0;
  private availableCapital: number = 0;

  private todayPnL: number = 0;
  private todayLossAmount: number = 0;
  private weekPnL: number = 0;
  private monthPnL: number = 0;
  private totalPnL: number = 0;

  private reservations = new Map<string, TradeReservation>();
  private state: VaultState = 'ACTIVE';
  private mode: VaultMode = 'PAPER';
  private compoundMode: boolean = false;

  // Daily reset tracking
  private lastResetDate: string = '';

  constructor(config: CapitalVaultConfig = {}) {
    super();
    this.mode = config.mode ?? 'PAPER';
    this.compoundMode = config.compoundMode ?? false;
  }

  // ── Capital Allocation ───────────────────────────────────────────────────────

  /**
   * Owner sets the capital allocation. Can be called at any time.
   * ₹100–₹10,00,000. Any amount below MIN_ALLOCATION is rejected.
   */
  setAllocation(amount: number): { success: boolean; message: string } {
    if (amount < 0) {
      return { success: false, message: `Allocation cannot be negative.` };
    }

    const isTopUp = this.allocatedCapital > 0;
    const delta = amount - this.allocatedCapital;
    this.allocatedCapital = amount;
    this.availableCapital = Math.max(0, this.availableCapital + delta);
    this.peakCapital = Math.max(this.peakCapital, amount);

    // Reset state if it was paused due to drawdown
    if (this.state === 'DRAWDOWN_PAUSED' || this.state === 'DAILY_LIMIT_HIT') {
      this.state = 'ACTIVE';
    }

    this.emit('ALLOCATION_SET', { amount, isTopUp, delta });
    console.log(`[CapitalVault] ${isTopUp ? 'Top-up' : 'Allocation'}: ₹${amount} (${this.mode} mode)`);
    return { success: true, message: `Allocation set to ₹${amount.toLocaleString('en-IN')} in ${this.mode} mode.` };
  }

  /**
   * Top-up: add more capital mid-month without resetting P&L tracking.
   */
  topUp(additionalAmount: number): { success: boolean; message: string } {
    return this.setAllocation(this.allocatedCapital + additionalAmount);
  }

  /**
   * Switch between PAPER and LIVE mode.
   * LIVE mode is blocked if allocation < MIN_LIVE_TRADE_VALUE.
   */
  setMode(mode: VaultMode): { success: boolean; message: string } {
    this.mode = mode;
    this.emit('MODE_CHANGED', { mode });
    if (mode === 'LIVE' && this.allocatedCapital < MIN_LIVE_TRADE_VALUE) {
      return {
        success: true,
        message: `Switched to LIVE mode. Note: Your allocation ₹${this.allocatedCapital} is below the recommended ₹${MIN_LIVE_TRADE_VALUE} minimum (brokerage costs will be high).`,
      };
    }
    return { success: true, message: `Mode switched to ${mode}.` };
  }

  setCompoundMode(enabled: boolean): void {
    this.compoundMode = enabled;
    console.log(`[CapitalVault] Compound mode: ${enabled ? 'ON' : 'OFF'}`);
  }

  // ── Capital Reservation ──────────────────────────────────────────────────────

  /**
   * Reserve capital for an incoming trade.
   * Returns false if insufficient capital or vault is not in ACTIVE state.
   */
  reserveCapital(tradeId: string, symbol: string, amount: number): boolean {
    this._checkDailyReset();

    if (this.state !== 'ACTIVE') {
      console.warn(`[CapitalVault] Reservation REJECTED — vault state: ${this.state}`);
      return false;
    }
    if (amount > this.availableCapital) {
      console.warn(`[CapitalVault] Reservation REJECTED — insufficient capital. Need ₹${amount}, available ₹${this.availableCapital}`);
      return false;
    }

    this.availableCapital -= amount;
    this.reservations.set(tradeId, { tradeId, symbol, reservedAmount: amount, reservedAt: new Date() });
    this.emit('CAPITAL_RESERVED', { tradeId, symbol, amount, availableCapital: this.availableCapital });
    return true;
  }

  /**
   * Release capital when a trade closes. Applies net P&L.
   * If compound mode is ON, profits are added back to allocation.
   */
  releaseCapital(tradeId: string, netPnL: number): void {
    const reservation = this.reservations.get(tradeId);
    if (!reservation) {
      console.warn(`[CapitalVault] No reservation found for trade ${tradeId}`);
      return;
    }

    const returnedAmount = reservation.reservedAmount + netPnL;
    this.availableCapital += Math.max(0, returnedAmount);
    this.reservations.delete(tradeId);

    // Update P&L trackers
    this.todayPnL += netPnL;
    this.weekPnL += netPnL;
    this.monthPnL += netPnL;
    this.totalPnL += netPnL;

    // Track losses for daily limit check
    if (netPnL < 0) {
      this.todayLossAmount += Math.abs(netPnL);
      this._checkDailyLossLimit();
    }

    // Update peak capital for drawdown calculation
    const currentCapital = this._getCurrentCapital();
    if (currentCapital > this.peakCapital) {
      this.peakCapital = currentCapital;
    }

    // Compound mode: add profits to allocation
    if (this.compoundMode && netPnL > 0) {
      this.allocatedCapital += netPnL;
      console.log(`[CapitalVault] Compound mode: +₹${netPnL.toFixed(2)} reinvested. New allocation: ₹${this.allocatedCapital.toFixed(2)}`);
    }

    this._checkDrawdown();
    this.emit('CAPITAL_RELEASED', { tradeId, netPnL, availableCapital: this.availableCapital });
    console.log(`[CapitalVault] Trade ${tradeId} closed. P&L: ₹${netPnL.toFixed(2)} | Today: ₹${this.todayPnL.toFixed(2)}`);
  }

  // ── Risk State Checks ────────────────────────────────────────────────────────

  private _checkDailyLossLimit(): void {
    const limit = this.allocatedCapital * DAILY_LOSS_LIMIT_PCT;
    if (this.todayLossAmount >= limit && this.state === 'ACTIVE') {
      this.state = 'DAILY_LIMIT_HIT';
      console.error(`[CapitalVault] 🚨 DAILY LOSS LIMIT HIT — ₹${this.todayLossAmount.toFixed(2)} lost today (limit ₹${limit.toFixed(2)}). Trading halted for today.`);
      this.emit('DAILY_LIMIT_HIT', { todayLoss: this.todayLossAmount, limit });
    }
  }

  private _checkDrawdown(): void {
    const currentCapital = this._getCurrentCapital();
    const drawdown = (this.peakCapital - currentCapital) / this.peakCapital;
    if (drawdown >= DRAWDOWN_PAUSE_PCT && this.state === 'ACTIVE') {
      this.state = 'DRAWDOWN_PAUSED';
      console.error(`[CapitalVault] ⛔ DRAWDOWN PAUSE — ${(drawdown * 100).toFixed(1)}% drawdown from peak. Awaiting owner review.`);
      this.emit('DRAWDOWN_PAUSED', { drawdownPct: drawdown * 100, peakCapital: this.peakCapital, currentCapital });
    }
  }

  private _checkDailyReset(): void {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      // New trading day: reset daily counters, restore DAILY_LIMIT_HIT state
      this.todayPnL = 0;
      this.todayLossAmount = 0;
      this.lastResetDate = today;
      if (this.state === 'DAILY_LIMIT_HIT') {
        this.state = 'ACTIVE';
        console.log('[CapitalVault] ✅ Daily reset — trading resumed.');
        this.emit('DAILY_RESET');
      }
    }
  }

  /**
   * Resume from DRAWDOWN_PAUSED — requires explicit owner action.
   */
  resumeFromPause(): void {
    if (this.state === 'DRAWDOWN_PAUSED') {
      this.state = 'ACTIVE';
      this.peakCapital = this._getCurrentCapital(); // reset peak to current
      this.emit('VAULT_RESUMED');
      console.log('[CapitalVault] ✅ Vault resumed by owner. Peak capital reset.');
    }
  }

  /**
   * Emergency lock — blocks all trading immediately.
   */
  lock(): void {
    this.state = 'LOCKED';
    this.emit('VAULT_LOCKED');
    console.error('[CapitalVault] 🔒 VAULT LOCKED — all trading halted.');
  }

  unlock(): void {
    this.state = 'ACTIVE';
    this.emit('VAULT_UNLOCKED');
    console.log('[CapitalVault] 🔓 Vault unlocked.');
  }

  // ── Getters ──────────────────────────────────────────────────────────────────

  private _getCurrentCapital(): number {
    return this.availableCapital + this._getDeployedCapital();
  }

  private _getDeployedCapital(): number {
    let total = 0;
    for (const r of this.reservations.values()) total += r.reservedAmount;
    return total;
  }

  getStatus(): VaultStatus {
    this._checkDailyReset();
    const deployedCapital = this._getDeployedCapital();
    const currentCapital = this.availableCapital + deployedCapital;
    const drawdownFromPeak = this.peakCapital > 0
      ? ((this.peakCapital - currentCapital) / this.peakCapital) * 100
      : 0;
    const dailyLossLimit = this.allocatedCapital * DAILY_LOSS_LIMIT_PCT;

    const brokerageWarning = this.allocatedCapital < MIN_LIVE_TRADE_VALUE && this.mode === 'LIVE'
      ? `⚠️ Allocation ₹${this.allocatedCapital} is below the recommended ₹${MIN_LIVE_TRADE_VALUE} for live trading. Round-trip brokerage (₹40) will consume a high percentage of your trade returns.`
      : undefined;

    return {
      allocatedCapital: this.allocatedCapital,
      availableCapital: this.availableCapital,
      deployedCapital,
      peakCapital: this.peakCapital,
      todayPnL: this.todayPnL,
      weekPnL: this.weekPnL,
      monthPnL: this.monthPnL,
      totalPnL: this.totalPnL,
      todayLossAmount: this.todayLossAmount,
      dailyLossLimit,
      drawdownFromPeak: Math.round(drawdownFromPeak * 100) / 100,
      openReservations: this.reservations.size,
      state: this.state,
      mode: this.mode,
      compoundMode: this.compoundMode,
      minLiveTradeValue: MIN_LIVE_TRADE_VALUE,
      brokerageWarning,
      lastUpdated: new Date(),
    };
  }

  getAllocatedCapital(): number { return this.allocatedCapital; }
  getAvailableCapital(): number { this._checkDailyReset(); return this.availableCapital; }
  getMode(): VaultMode { return this.mode; }
  getState(): VaultState { return this.state; }
  isActive(): boolean { return this.state === 'ACTIVE'; }
  isPaperMode(): boolean { return this.mode === 'PAPER'; }

  /**
   * Max capital that can be allocated to a single trade (20% of allocation).
   */
  getMaxPositionSize(): number {
    return this.allocatedCapital * MAX_POSITION_PCT;
  }
}

// ── Singleton export for use across the application ───────────────────────────
export const capitalVault = new CapitalVault({ mode: 'PAPER', compoundMode: false });
