/**
 * RiskGuardian.test.ts — Phase 19 Unit Tests
 * Tests institutional risk guardian rules including consecutive loss circuit breaker,
 * position concentration, confidence threshold, and position limits.
 */

import { CapitalVault } from '../vault/CapitalVault';
import { RiskGuardian } from '../vault/RiskGuardian';
import { SignalEvent } from '../signals/SignalEvent';

function mockSignal(confidence = 75, qty = 10, entryPrice = 200): SignalEvent {
  return {
    signal_id: `sig-${Math.random()}`,
    symbol: 'RELIANCE',
    exchange: 'NSE',
    direction: 'LONG',
    strength: 'STRONG',
    confidence,
    entry_price: entryPrice,
    stop_loss: entryPrice * 0.98,
    take_profit: entryPrice * 1.04,
    rsi: 55,
    macd_hist: 1.2,
    atr: 5,
    ema20: 198,
    ema50: 195,
    regime: 'TRENDING_UP',
    recommended_qty: qty,
    emitted_at: new Date(),
    bar_ts: new Date(),
  };
}

describe('RiskGuardian', () => {
  let vault: CapitalVault;
  let guardian: RiskGuardian;

  beforeEach(() => {
    vault = new CapitalVault({ mode: 'PAPER' });
    vault.setAllocation(10_000);
    guardian = new RiskGuardian(vault, {
      maxConcurrentPositions: 3,
      minConfidence: 60,
      humanApprovalThresholdINR: 5_000,
      consecutiveLossLimit: 3,
      consecutiveLossCooldownMs: 60_000, // 1 min for test
    });
  });

  test('approves valid signal within risk rules (GO)', () => {
    const signal = mockSignal(75, 5, 200); // 5 * 200 = ₹1,000 trade value (< 20% of 10k = 2k limit)
    const decision = guardian.canExecute(signal, 1_000);
    expect(decision.verdict).toBe('GO');
  });

  test('rejects signal below minimum confidence (60%)', () => {
    const signal = mockSignal(55, 5, 200);
    const decision = guardian.canExecute(signal, 1_000);
    expect(decision.verdict).toBe('REJECT');
    expect(decision.reason).toContain('below minimum threshold 60%');
  });

  test('scales down quantity when trade value exceeds 20% position concentration', () => {
    const signal = mockSignal(80, 20, 200); // 20 * 200 = ₹4,000 trade value (> ₹2,000 20% limit)
    const decision = guardian.canExecute(signal, 4_000);
    expect(decision.verdict).toBe('SCALE_DOWN');
    expect(decision.adjustedQty).toBe(10); // scaled down to ₹2,000 / ₹200 = 10 shares
  });

  test('enforces max 3 concurrent open positions limit', () => {
    guardian.onPositionOpened();
    guardian.onPositionOpened();
    guardian.onPositionOpened(); // 3 open

    const signal = mockSignal(80, 5, 200);
    const decision = guardian.canExecute(signal, 1_000);
    expect(decision.verdict).toBe('REJECT');
    expect(decision.reason).toContain('Max concurrent positions reached (3/3)');
  });

  test('triggers consecutive loss cooldown after 3 losing trades', () => {
    guardian.onPositionClosed(-100);
    guardian.onPositionClosed(-150);
    guardian.onPositionClosed(-80); // 3 consecutive losses

    const report = guardian.getRiskReport();
    expect(report.cooldownActive).toBe(true);

    const signal = mockSignal(80, 5, 200);
    const decision = guardian.canExecute(signal, 1_000);
    expect(decision.verdict).toBe('REJECT');
    expect(decision.reason).toContain('Consecutive loss circuit breaker active');
  });

  test('resets consecutive loss streak on a profitable trade', () => {
    guardian.onPositionClosed(-100);
    guardian.onPositionClosed(-150);
    guardian.onPositionClosed(200); // Winning trade resets streak!

    const report = guardian.getRiskReport();
    expect(report.consecutiveLosses).toBe(0);
    expect(report.cooldownActive).toBe(false);
  });

  test('triggers PAPER_ONLY mode when trade value < ₹2,000 in LIVE mode', () => {
    vault.setAllocation(10_000);
    vault.setMode('LIVE');
    const signal = mockSignal(80, 5, 200); // ₹1,000 trade value (< ₹2,000 min for live)

    const decision = guardian.canExecute(signal, 1_000);
    expect(decision.verdict).toBe('PAPER_ONLY');
    expect(decision.reason).toContain('below ₹2000 minimum for live trading');
  });
});
