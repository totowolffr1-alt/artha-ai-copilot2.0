/**
 * packages/phase5-strategy/src/__tests__/MarketSessionGuard.test.ts
 * Artha AI — NSE Market Session Guard Unit Tests
 */

import { MarketSessionGuard } from '../signals/MarketSessionGuard';

describe('MarketSessionGuard — NSE Session Rules', () => {
  // Helper to construct UTC timestamp for a specific IST date/time
  // IST = UTC + 5:30 -> UTC = IST - 5:30
  function makeIstTimestamp(year: number, month: number, day: number, hour: number, minute: number): number {
    return Date.UTC(year, month - 1, day, hour - 5, minute - 30);
  }

  test('blocks trading on weekends (Saturday & Sunday)', () => {
    // Saturday 2026-07-25 11:00 IST
    const satTs = makeIstTimestamp(2026, 7, 25, 11, 0);
    const satSession = MarketSessionGuard.getSessionInfo(satTs);
    expect(satSession.status).toBe('WEEKEND');
    expect(satSession.canTrade).toBe(false);

    // Sunday 2026-07-26 11:00 IST
    const sunTs = makeIstTimestamp(2026, 7, 26, 11, 0);
    const sunSession = MarketSessionGuard.getSessionInfo(sunTs);
    expect(sunSession.status).toBe('WEEKEND');
    expect(sunSession.canTrade).toBe(false);
  });

  test('blocks trading on national/NSE holidays', () => {
    // Independence Day 2025-08-15 (Friday) 11:00 IST
    const holidayTs = makeIstTimestamp(2025, 8, 15, 11, 0);
    const session = MarketSessionGuard.getSessionInfo(holidayTs);
    expect(session.status).toBe('HOLIDAY');
    expect(session.canTrade).toBe(false);
  });

  test('blocks trading during pre-open session (09:00 – 09:15 IST)', () => {
    // Wednesday 2026-07-22 09:05 IST
    const preOpenTs = makeIstTimestamp(2026, 7, 22, 9, 5);
    const session = MarketSessionGuard.getSessionInfo(preOpenTs);
    expect(session.status).toBe('PRE_OPEN');
    expect(session.canTrade).toBe(false);
  });

  test('blocks trading during opening volatility window (09:15 – 09:30 IST)', () => {
    // Wednesday 2026-07-22 09:20 IST
    const volTs = makeIstTimestamp(2026, 7, 22, 9, 20);
    const session = MarketSessionGuard.getSessionInfo(volTs);
    expect(session.status).toBe('OPENING_VOLATILITY');
    expect(session.canTrade).toBe(false);
  });

  test('allows trading during safe market hours (09:30 – 15:15 IST)', () => {
    // Wednesday 2026-07-22 10:45 IST
    const safeTs = makeIstTimestamp(2026, 7, 22, 10, 45);
    const session = MarketSessionGuard.getSessionInfo(safeTs);
    expect(session.status).toBe('OPEN');
    expect(session.canTrade).toBe(true);
  });

  test('blocks new entries during closing window (15:15 – 15:30 IST)', () => {
    // Wednesday 2026-07-22 15:20 IST
    const closeWindowTs = makeIstTimestamp(2026, 7, 22, 15, 20);
    const session = MarketSessionGuard.getSessionInfo(closeWindowTs);
    expect(session.status).toBe('CLOSING_WINDOW');
    expect(session.canTrade).toBe(false);
    expect(MarketSessionGuard.isClosingWindow(closeWindowTs)).toBe(true);
  });

  test('blocks trading after market close (after 15:30 IST)', () => {
    // Wednesday 2026-07-22 16:00 IST
    const afterHoursTs = makeIstTimestamp(2026, 7, 22, 16, 0);
    const session = MarketSessionGuard.getSessionInfo(afterHoursTs);
    expect(session.status).toBe('CLOSED');
    expect(session.canTrade).toBe(false);
  });

  test('calculates remaining safe minutes correctly', () => {
    // Wednesday 2026-07-22 14:15 IST -> 60 minutes until 15:15 IST
    const ts = makeIstTimestamp(2026, 7, 22, 14, 15);
    expect(MarketSessionGuard.minutesUntilClose(ts)).toBe(60);
  });
});
