/**
 * packages/phase9-testing/src/__tests__/CircuitLimit.test.ts
 * Artha AI — Phase 9 Circuit Limit Guard Tests
 */

import { CircuitLimitGuard } from '../guards/CircuitLimitGuard';

describe('CircuitLimitGuard', () => {
  const guard = new CircuitLimitGuard();

  test('passes when price is far from circuit boundaries', () => {
    // prevClose = 100, limitPct = 10 (bounds: 90 to 110)
    // ltp = 100 (in middle)
    const result = guard.checkCircuitBoundary(100, 100, 10);
    expect(result.passed).toBe(true);
  });

  test('blocks when price approaches upper circuit boundary (within 0.5%)', () => {
    // prevClose = 100, limitPct = 10 (bounds: 90 to 110)
    // upper boundary threshold = 110 * 0.995 = 109.45
    // ltp = 109.5 (too close)
    const result = guard.checkCircuitBoundary(109.5, 100, 10);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('APPROACHING_UPPER_CIRCUIT');
  });

  test('blocks when price approaches lower circuit boundary (within 0.5%)', () => {
    // prevClose = 100, limitPct = 10 (bounds: 90 to 110)
    // lower boundary threshold = 90 * 1.005 = 90.45
    // ltp = 90.4 (too close)
    const result = guard.checkCircuitBoundary(90.4, 100, 10);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('APPROACHING_LOWER_CIRCUIT');
  });

  test('returns error on invalid price inputs', () => {
    const result = guard.checkCircuitBoundary(-10, 100, 10);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('INVALID_PRICE_INPUTS');
  });
});
