/**
 * src/marketData/connection/ExponentialBackoff.ts
 * Phase 2C — IConnectionStrategy: exponential backoff implementation.
 *
 * Delay schedule (from IConnectionStrategy.ts constants):
 *   Attempt 1 →  3s
 *   Attempt 2 →  6s
 *   Attempt 3 → 12s
 *   Attempt 4 → 24s
 *   Attempt 5 → 48s
 *   Attempt 6+ → false (emit RECONNECT_FAILED)
 *
 * reset() is called on successful CONNECTED event to restart the counter.
 * Injected into MarketDataService — swappable for tests (FixedInterval, NoRetry).
 */

import type { IConnectionStrategy } from './IConnectionStrategy';
import { BACKOFF_DELAYS_MS, BACKOFF_MAX_ATTEMPTS } from './IConnectionStrategy';

export class ExponentialBackoff implements IConnectionStrategy {
  readonly maxAttempts = BACKOFF_MAX_ATTEMPTS;

  shouldRetry(attemptNumber: number): boolean {
    return attemptNumber <= this.maxAttempts;
  }

  nextDelay(attemptNumber: number): number {
    const idx = Math.min(attemptNumber - 1, BACKOFF_DELAYS_MS.length - 1);
    return BACKOFF_DELAYS_MS[idx] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1] ?? 48_000;
  }

  reset(): void {
    // Stateless — nothing to reset. Attempt numbering is managed by caller.
  }
}
