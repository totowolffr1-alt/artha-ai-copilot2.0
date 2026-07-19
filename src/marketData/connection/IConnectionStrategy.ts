/**
 * src/marketData/connection/IConnectionStrategy.ts
 * Phase 2B — Reconnection strategy interface + backoff constants.
 *
 * Decouples the retry policy from the adapter.
 * The same ExponentialBackoff works for any adapter implementation.
 * A different strategy (e.g. FixedInterval, NoRetry) can be injected for tests.
 */

import type { Result } from '../../utils/errors';

// ─── IConnectionStrategy ──────────────────────────────────────────────────────

export interface IConnectionStrategy {
  /**
   * Whether another connection attempt should be made.
   * Called before each attempt.
   *
   * @param attemptNumber 1-indexed attempt count
   * @returns true  → proceed with attempt
   * @returns false → abort, emit RECONNECT_FAILED
   */
  shouldRetry(attemptNumber: number): boolean;

  /**
   * Delay in milliseconds before attempt N.
   * Called after shouldRetry() returns true, before the wait.
   *
   * @param attemptNumber 1-indexed
   * @returns ms to wait before making the connection attempt
   */
  nextDelay(attemptNumber: number): number;

  /**
   * Reset internal state after a successful connection.
   * Must be called by MarketDataService when CONNECTED event fires.
   * Resets the attempt counter so the next disconnect starts fresh.
   */
  reset(): void;

  /** Maximum number of attempts this strategy will permit. */
  readonly maxAttempts: number;
}

// ─── ExponentialBackoff constants ─────────────────────────────────────────────

/**
 * Delay schedule for ExponentialBackoff (implementation in Phase 3).
 * Attempt 1 → 3s, 2 → 6s, 3 → 12s, 4 → 24s, 5 → 48s.
 * After attempt 5: emit RECONNECT_FAILED, stop.
 */
export const BACKOFF_DELAYS_MS: readonly number[] = [
  3_000,
  6_000,
  12_000,
  24_000,
  48_000,
] as const;

export const BACKOFF_MAX_ATTEMPTS = BACKOFF_DELAYS_MS.length; // 5

// ─── ConnectionMonitor constants ──────────────────────────────────────────────

/**
 * SmartAPI requires a heartbeat ping every 10 seconds.
 * ConnectionMonitor sends "ping" on this interval.
 */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Number of consecutive missed pings before the connection is declared dead.
 * At 10s interval + 3 misses = 30s before forced reconnect.
 */
export const HEARTBEAT_MISS_THRESHOLD = 3;
