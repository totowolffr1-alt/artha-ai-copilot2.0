/**
 * packages/phase9-testing/src/guards/CircuitLimitGuard.ts
 * Artha AI — Phase 9 Circuit Limit Guard
 *
 * Blocks entry when a stock is locked in or approaching its daily circuit limits (5%, 10%, 20%).
 * Extremely critical for small caps, where liquidity freezes at circuit boundaries.
 */

export class CircuitLimitGuard {
  /**
   * Checks if price is too close to upper or lower circuit limit.
   * Blocks if price is within 0.5% of either limit.
   */
  checkCircuitBoundary(
    ltp: number,
    prevClose: number,
    limitPct: number
  ): { passed: boolean; reason?: string } {
    if (ltp <= 0 || prevClose <= 0 || limitPct <= 0) {
      return { passed: false, reason: 'INVALID_PRICE_INPUTS' };
    }

    const upperLimit = prevClose * (1 + limitPct / 100);
    const lowerLimit = prevClose * (1 - limitPct / 100);

    // If within 0.5% of upper circuit limit
    if (ltp >= upperLimit * 0.995) {
      return {
        passed: false,
        reason: `APPROACHING_UPPER_CIRCUIT: LTP ₹${ltp.toFixed(2)} is near upper limit ₹${upperLimit.toFixed(2)}`,
      };
    }

    // If within 0.5% of lower circuit limit
    if (ltp <= lowerLimit * 1.005) {
      return {
        passed: false,
        reason: `APPROACHING_LOWER_CIRCUIT: LTP ₹${ltp.toFixed(2)} is near lower limit ₹${lowerLimit.toFixed(2)}`,
      };
    }

    return { passed: true };
  }
}
