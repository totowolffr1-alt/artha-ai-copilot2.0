/**
 * src/marketData/SubscriptionManager.ts
 * Phase 2B — Subscription ref-counting interface.
 *
 * Prevents duplicate WebSocket subscriptions when multiple UI components
 * subscribe to the same symbol. Respects SmartAPI's 1,000-token-per-connection
 * hard limit by ensuring each symbol is subscribed exactly once at the adapter
 * level, regardless of how many callbacks are registered.
 *
 * Lifecycle:
 *   acquire() → true  (first subscriber)  → caller must call adapter.subscribeRawTick()
 *   acquire() → false (already subscribed) → caller just registers callback, no adapter call
 *   release() → false (others remain)      → adapter subscription maintained
 *   release() → true  (last subscriber)    → caller must call adapter.unsubscribeRawTick()
 */

import type { Timeframe } from './types';

// ─── Key types ────────────────────────────────────────────────────────────────

export interface TickSubscriptionKey {
  readonly kind:   'tick';
  readonly symbol: string;
}

export interface CandleSubscriptionKey {
  readonly kind:      'candle';
  readonly symbol:    string;
  readonly timeframe: Timeframe;
}

/**
 * Discriminated union for all subscription key types.
 * Serialised as a string for use as Map keys: `tick:RELIANCE` or `candle:RELIANCE:5m`.
 */
export type SubscriptionKey = TickSubscriptionKey | CandleSubscriptionKey;

// ─── Subscription state snapshot ─────────────────────────────────────────────

export interface SubscriptionRecord {
  readonly key:          SubscriptionKey;
  readonly refCount:     number;
  readonly subscribedAt: number;   // unix ms UTC — when first subscriber registered
}

// ─── ISubscriptionManager ────────────────────────────────────────────────────

export interface ISubscriptionManager {
  /**
   * Increment ref count for this key.
   *
   * @returns true  if this is the FIRST subscriber → adapter subscription needed.
   * @returns false if already subscribed            → no adapter call, just add callback.
   */
  acquire(key: SubscriptionKey): boolean;

  /**
   * Decrement ref count for this key.
   *
   * @returns true  if ref count reaches 0 → adapter unsubscription needed.
   * @returns false if other subscribers remain → adapter subscription maintained.
   *
   * Safe to call with an unknown key — returns false without throwing.
   */
  release(key: SubscriptionKey): boolean;

  /**
   * Current ref count for a key.
   * Returns 0 if key is not tracked (not subscribed).
   */
  count(key: SubscriptionKey): number;

  /**
   * All keys currently with refCount > 0.
   * Used by ConnectionMonitor and debugging.
   */
  active(): readonly SubscriptionKey[];

  /**
   * Full records for all active subscriptions, including ref counts and timestamps.
   * Used for status display and leak detection.
   */
  activeRecords(): readonly SubscriptionRecord[];

  /**
   * Returns all keys that must be re-subscribed after a reconnect.
   * Called by MarketDataService when CONNECTED event fires after a reconnect.
   * Returns only keys with refCount > 0 at the time of the reconnect.
   */
  getResubscriptionList(): readonly SubscriptionKey[];

  /**
   * Total number of distinct symbols currently subscribed (tick or candle).
   * Must not exceed SmartAPI's MAX_TOKENS_PER_WS = 1,000.
   */
  distinctSymbolCount(): number;

  /**
   * Remove all tracked subscriptions without calling release().
   * Called during disconnect() to reset state.
   * Does NOT trigger adapter unsubscription (caller is responsible if needed).
   */
  clear(): void;
}

// ─── Key serialisation helpers ────────────────────────────────────────────────

/**
 * Stable string key for use in Map / Set.
 * tick:RELIANCE  |  candle:RELIANCE:5m
 */
export const serializeKey = (key: SubscriptionKey): string =>
  key.kind === 'tick'
    ? `tick:${key.symbol}`
    : `candle:${key.symbol}:${key.timeframe}`;

export const deserializeKey = (raw: string): SubscriptionKey | null => {
  const parts = raw.split(':');
  if (parts[0] === 'tick'   && parts.length === 2) return { kind: 'tick',   symbol: parts[1] };
  if (parts[0] === 'candle' && parts.length === 3) return { kind: 'candle', symbol: parts[1], timeframe: parts[2] as Timeframe };
  return null;
};
