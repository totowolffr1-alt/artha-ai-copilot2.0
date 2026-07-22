/**
 * CapitalVault.test.ts — Phase 19 Unit Tests
 * Tests dynamic capital allocation, reservation, release, compounding, and mode enforcement.
 */

import { CapitalVault } from '../vault/CapitalVault';

describe('CapitalVault Engine', () => {
  let vault: CapitalVault;

  beforeEach(() => {
    vault = new CapitalVault({ mode: 'PAPER', compoundMode: false });
  });

  test('sets allocation correctly for ₹10,000', () => {
    const res = vault.setAllocation(10_000);
    expect(res.success).toBe(true);
    expect(vault.getAllocatedCapital()).toBe(10_000);
    expect(vault.getAvailableCapital()).toBe(10_000);
    expect(vault.getStatus().peakCapital).toBe(10_000);
  });

  test('rejects allocation below ₹100', () => {
    const res = vault.setAllocation(50);
    expect(res.success).toBe(false);
    expect(res.message).toContain('Minimum allocation is ₹100');
  });

  test('reserves capital for valid trade and updates available balance', () => {
    vault.setAllocation(10_000);
    const ok = vault.reserveCapital('trade-1', 'RELIANCE', 2_000);
    expect(ok).toBe(true);
    expect(vault.getAvailableCapital()).toBe(8_000);
    expect(vault.getStatus().deployedCapital).toBe(2_000);
  });

  test('rejects reservation exceeding available capital', () => {
    vault.setAllocation(5_000);
    const ok = vault.reserveCapital('trade-1', 'TCS', 6_000);
    expect(ok).toBe(false);
    expect(vault.getAvailableCapital()).toBe(5_000);
  });

  test('releases capital and updates net P&L correctly', () => {
    vault.setAllocation(10_000);
    vault.reserveCapital('trade-1', 'CUPID', 2_000);
    vault.releaseCapital('trade-1', 350); // +₹350 profit

    const status = vault.getStatus();
    expect(status.availableCapital).toBe(10_350);
    expect(status.todayPnL).toBe(350);
    expect(status.totalPnL).toBe(350);
  });

  test('reinvests profits automatically in compound mode', () => {
    const compVault = new CapitalVault({ mode: 'PAPER', compoundMode: true });
    compVault.setAllocation(10_000);
    compVault.reserveCapital('trade-1', 'KPITTECH', 2_000);
    compVault.releaseCapital('trade-1', 500); // +₹500 profit

    expect(compVault.getAllocatedCapital()).toBe(10_500);
  });

  test('enforces PAPER mode when allocation < ₹2,000 for brokerage protection', () => {
    vault.setAllocation(500); // Below ₹2,000 threshold
    const res = vault.setMode('LIVE');
    expect(res.success).toBe(false);
    expect(res.message).toContain('Minimum capital for live trading is ₹2,000');
    expect(vault.getMode()).toBe('PAPER');
  });

  test('allows LIVE mode when allocation >= ₹2,000', () => {
    vault.setAllocation(5_000);
    const res = vault.setMode('LIVE');
    expect(res.success).toBe(true);
    expect(vault.getMode()).toBe('LIVE');
  });

  test('triggers DAILY_LIMIT_HIT when 5% loss is reached', () => {
    vault.setAllocation(10_000); // 5% limit = ₹500
    vault.reserveCapital('trade-1', 'INFY', 2_000);
    vault.releaseCapital('trade-1', -550); // -₹550 loss (> ₹500 limit)

    expect(vault.getState()).toBe('DAILY_LIMIT_HIT');
    expect(vault.isActive()).toBe(false);

    // Further reservations should be rejected
    const ok = vault.reserveCapital('trade-2', 'WIPRO', 1_000);
    expect(ok).toBe(false);
  });
});
