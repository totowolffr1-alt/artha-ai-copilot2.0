/**
 * packages/phase10-copilot-intelligence/src/guards/AlertCooldownGuard.ts
 * Artha AI — Phase 10 Alert Cooldown Guard
 *
 * Prevents the same symbol from generating back-to-back notifications
 * within a configurable cooldown window (default: 30 minutes).
 * In-memory only — resets on process restart.
 */

export class AlertCooldownGuard {
  /** symbol → last alert timestamp (ms) */
  private readonly lastAlertTime = new Map<string, number>();

  constructor(
    private readonly cooldownMs: number = 30 * 60 * 1000 // 30 minutes
  ) {}

  /**
   * Returns true if the symbol is allowed to fire a new alert.
   */
  canAlert(symbol: string, now: number = Date.now()): boolean {
    const last = this.lastAlertTime.get(symbol);
    if (last === undefined) return true;
    return now - last >= this.cooldownMs;
  }

  /**
   * Record that an alert was sent for this symbol.
   */
  markAlerted(symbol: string, now: number = Date.now()): void {
    this.lastAlertTime.set(symbol, now);
  }

  /**
   * Returns ms remaining in cooldown for a symbol (0 if not cooling down).
   */
  remainingCooldownMs(symbol: string, now: number = Date.now()): number {
    const last = this.lastAlertTime.get(symbol);
    if (last === undefined) return 0;
    const elapsed = now - last;
    return Math.max(0, this.cooldownMs - elapsed);
  }

  /**
   * Clear cooldown for a symbol (e.g., manual override).
   */
  clearCooldown(symbol: string): void {
    this.lastAlertTime.delete(symbol);
  }

  /**
   * Clear all cooldowns (e.g., at market open).
   */
  clearAll(): void {
    this.lastAlertTime.clear();
  }
}
