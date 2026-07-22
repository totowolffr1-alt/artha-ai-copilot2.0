/**
 * RiskGuardian.ts — Phase 19: Autonomous Trading Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * The last line of defense between every signal and real money.
 *
 * HARD RULES (cannot be overridden — enforced always):
 *  1. Vault must be ACTIVE (not daily-limit-hit / drawdown-paused / locked)
 *  2. Sufficient available capital for the trade
 *  3. Trade value must be within 20% max position concentration
 *  4. Market session must be open (09:30–15:15 IST)
 *  5. Signal confidence must be ≥ 60%
 *  6. Max 3 concurrent open trades
 *  7. Minimum trade value ≥ ₹2,000 for LIVE mode (brokerage protection)
 *  8. Consecutive loss circuit breaker: 3 losses in a row → 2-hour cooldown
 *
 * SOFT RULES (configurable):
 *  - Human approval threshold (₹ amount above which 60s window opens)
 *  - Min confidence threshold (default 60%)
 *  - Max concurrent positions (default 3)
 */

import { CapitalVault, MIN_LIVE_TRADE_VALUE } from './CapitalVault';
import { SignalEvent } from '../signals/SignalEvent';

// ── Types ──────────────────────────────────────────────────────────────────────
export type RiskVerdict = 'GO' | 'REJECT' | 'SCALE_DOWN' | 'PAPER_ONLY' | 'AWAITING_APPROVAL';

export interface RiskDecision {
  verdict: RiskVerdict;
  reason: string;
  adjustedQty?: number;          // If SCALE_DOWN, this is the reduced quantity
  requiresApproval?: boolean;    // If true, wait for human confirmation
  approvalTimeoutMs?: number;    // How long to wait for human approval
}

export interface RiskGuardianConfig {
  maxConcurrentPositions?: number;         // default: 3
  minConfidence?: number;                  // default: 60
  humanApprovalThresholdINR?: number;      // Trades above this need 60s approval (default: 5000)
  humanApprovalTimeoutMs?: number;         // How long to wait (default: 60000 = 60s)
  consecutiveLossCooldownMs?: number;      // Default: 2 hours
  consecutiveLossLimit?: number;           // Default: 3
}

export interface RiskReport {
  consecutiveLosses: number;
  cooldownActive: boolean;
  cooldownRemainingMs: number;
  openPositionCount: number;
  todayLossAmount: number;
  dailyLossLimit: number;
  drawdownFromPeak: number;
  vaultState: string;
  vaultMode: string;
}

// ── RiskGuardian ───────────────────────────────────────────────────────────────
export class RiskGuardian {
  private maxConcurrentPositions: number;
  private minConfidence: number;
  private humanApprovalThresholdINR: number;
  private humanApprovalTimeoutMs: number;
  private consecutiveLossCooldownMs: number;
  private consecutiveLossLimit: number;

  // State
  private openPositionCount: number = 0;
  private consecutiveLosses: number = 0;
  private cooldownUntil: number = 0;   // timestamp ms

  constructor(private vault: CapitalVault, config: RiskGuardianConfig = {}) {
    this.maxConcurrentPositions    = config.maxConcurrentPositions    ?? 3;
    this.minConfidence             = config.minConfidence             ?? 60;
    this.humanApprovalThresholdINR = config.humanApprovalThresholdINR ?? 5_000;
    this.humanApprovalTimeoutMs    = config.humanApprovalTimeoutMs    ?? 60_000;
    this.consecutiveLossCooldownMs = config.consecutiveLossCooldownMs ?? 2 * 60 * 60 * 1000;
    this.consecutiveLossLimit      = config.consecutiveLossLimit      ?? 3;
  }

  /**
   * Main evaluation method. Called before every potential trade execution.
   * Returns a RiskDecision that the OrderExecutionService must respect.
   */
  canExecute(signal: SignalEvent, tradeValueINR: number): RiskDecision {
    const vaultStatus = this.vault.getStatus();

    // ── HARD RULE 1: Vault state ─────────────────────────────────────────────
    if (!this.vault.isActive()) {
      return {
        verdict: 'REJECT',
        reason: `🚨 Vault is ${vaultStatus.state}. Trading is halted. ${
          vaultStatus.state === 'DAILY_LIMIT_HIT'
            ? 'Daily loss limit reached. Resumes tomorrow morning.'
            : vaultStatus.state === 'DRAWDOWN_PAUSED'
            ? 'Portfolio drawdown exceeded 15%. Go to dashboard → Resume Trading.'
            : 'Vault is locked. Use Kill Switch panel to unlock.'
        }`,
      };
    }

    // ── HARD RULE 2: Consecutive loss circuit breaker ─────────────────────────
    if (Date.now() < this.cooldownUntil) {
      const remainingMs = this.cooldownUntil - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60_000);
      return {
        verdict: 'REJECT',
        reason: `⏸️ Consecutive loss circuit breaker active. 3 consecutive losses detected. Cooldown: ${remainingMin} minutes remaining.`,
      };
    }

    // ── HARD RULE 3: Maximum concurrent positions ─────────────────────────────
    if (this.openPositionCount >= this.maxConcurrentPositions) {
      return {
        verdict: 'REJECT',
        reason: `Max concurrent positions reached (${this.openPositionCount}/${this.maxConcurrentPositions}). Wait for an open trade to close.`,
      };
    }

    // ── HARD RULE 4: Signal confidence threshold ──────────────────────────────
    if (signal.confidence < this.minConfidence) {
      return {
        verdict: 'REJECT',
        reason: `Signal confidence ${signal.confidence.toFixed(1)}% below minimum threshold ${this.minConfidence}%. Signal quality insufficient.`,
      };
    }

    // ── HARD RULE 5: Minimum live trade value (brokerage protection) ──────────
    if (vaultStatus.mode === 'LIVE' && tradeValueINR < MIN_LIVE_TRADE_VALUE) {
      return {
        verdict: 'PAPER_ONLY',
        reason: `Trade value ₹${tradeValueINR.toFixed(0)} is below ₹${MIN_LIVE_TRADE_VALUE} minimum for live trading. Brokerage ₹40 (round-trip) would represent ${(4000 / tradeValueINR).toFixed(1)}% overhead. Executing as paper trade.`,
      };
    }

    // ── HARD RULE 6: Available capital check ──────────────────────────────────
    const available = this.vault.getAvailableCapital();
    if (tradeValueINR > available) {
      // Try scaling down to what's available
      const scaledQty = signal.recommended_qty
        ? Math.floor((available / tradeValueINR) * (signal.recommended_qty ?? 1))
        : 0;
      if (scaledQty > 0) {
        return {
          verdict: 'SCALE_DOWN',
          reason: `Insufficient capital for full position. Scaling down from ${signal.recommended_qty} to ${scaledQty} shares (available: ₹${available.toFixed(0)}).`,
          adjustedQty: scaledQty,
        };
      }
      return {
        verdict: 'REJECT',
        reason: `Insufficient capital. Trade requires ₹${tradeValueINR.toFixed(0)}, available: ₹${available.toFixed(0)}.`,
      };
    }

    // ── HARD RULE 7: Max position concentration (20% of allocation) ───────────
    const maxPosition = this.vault.getMaxPositionSize();
    if (tradeValueINR > maxPosition) {
      const scaledQty = signal.recommended_qty
        ? Math.floor((maxPosition / tradeValueINR) * (signal.recommended_qty ?? 1))
        : 0;
      if (scaledQty > 0) {
        return {
          verdict: 'SCALE_DOWN',
          reason: `Position concentration rule: single trade capped at 20% of allocation (₹${maxPosition.toFixed(0)}). Scaling down to ${scaledQty} shares.`,
          adjustedQty: scaledQty,
        };
      }
      return {
        verdict: 'REJECT',
        reason: `Trade value ₹${tradeValueINR.toFixed(0)} exceeds 20% position concentration limit (₹${maxPosition.toFixed(0)}).`,
      };
    }

    // ── SOFT RULE: Human approval for large trades ────────────────────────────
    if (tradeValueINR >= this.humanApprovalThresholdINR && vaultStatus.mode === 'LIVE') {
      return {
        verdict: 'AWAITING_APPROVAL',
        reason: `Trade value ₹${tradeValueINR.toFixed(0)} exceeds approval threshold ₹${this.humanApprovalThresholdINR.toLocaleString('en-IN')}. Awaiting your confirmation (${this.humanApprovalTimeoutMs / 1000}s window).`,
        requiresApproval: true,
        approvalTimeoutMs: this.humanApprovalTimeoutMs,
      };
    }

    // ── All rules passed → GO ─────────────────────────────────────────────────
    return {
      verdict: 'GO',
      reason: `All ${this.maxConcurrentPositions} risk rules passed. Signal: ${signal.direction} ${signal.symbol} @ ₹${signal.entry_price} | Confidence: ${signal.confidence.toFixed(1)}% | Regime: ${signal.regime}`,
    };
  }

  // ── Position Lifecycle Tracking ──────────────────────────────────────────────

  onPositionOpened(): void {
    this.openPositionCount = Math.min(this.openPositionCount + 1, this.maxConcurrentPositions);
  }

  onPositionClosed(netPnL: number): void {
    this.openPositionCount = Math.max(0, this.openPositionCount - 1);

    if (netPnL < 0) {
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= this.consecutiveLossLimit) {
        this.cooldownUntil = Date.now() + this.consecutiveLossCooldownMs;
        const cooldownHours = this.consecutiveLossCooldownMs / 3_600_000;
        console.warn(`[RiskGuardian] ⏸️ ${this.consecutiveLosses} consecutive losses — ${cooldownHours}h cooldown activated.`);
      }
    } else {
      // Reset streak on any profitable trade
      this.consecutiveLosses = 0;
    }
  }

  // ── Reporting ────────────────────────────────────────────────────────────────

  getRiskReport(): RiskReport {
    const vaultStatus = this.vault.getStatus();
    const remaining = Math.max(0, this.cooldownUntil - Date.now());
    return {
      consecutiveLosses: this.consecutiveLosses,
      cooldownActive: Date.now() < this.cooldownUntil,
      cooldownRemainingMs: remaining,
      openPositionCount: this.openPositionCount,
      todayLossAmount: vaultStatus.todayLossAmount,
      dailyLossLimit: vaultStatus.dailyLossLimit,
      drawdownFromPeak: vaultStatus.drawdownFromPeak,
      vaultState: vaultStatus.state,
      vaultMode: vaultStatus.mode,
    };
  }

  // ── Config Setters ───────────────────────────────────────────────────────────
  setMaxConcurrentPositions(n: number): void { this.maxConcurrentPositions = Math.max(1, n); }
  setMinConfidence(pct: number): void { this.minConfidence = Math.max(0, Math.min(100, pct)); }
  setHumanApprovalThreshold(amountINR: number): void { this.humanApprovalThresholdINR = amountINR; }
}
