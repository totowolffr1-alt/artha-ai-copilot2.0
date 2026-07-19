/**
 * src/marketData/EventBus.ts
 * Phase 2B — Typed internal event bus interface + all MarketDataEvent shapes.
 *
 * INTERNAL ONLY. Never exported to consumers.
 * Consumers subscribe via IMarketDataProvider callbacks, not directly here.
 *
 * Producers:
 *   AngelOneAdapter  → TICK_RECEIVED, CONNECTED, DISCONNECTED, RECONNECTING,
 *                      RECONNECT_FAILED, SUBSCRIPTION_ERROR
 *   CandleAggregator → CANDLE_UPDATED, CANDLE_FORMED
 *   ConnectionMonitor → DISCONNECTED (heartbeat timeout path)
 *
 * Consumers (internal to MarketDataService):
 *   MarketDataService → listens to all events; routes to stores, callbacks
 *   CandleAggregator  → listens to TICK_RECEIVED; emits CANDLE_UPDATED/FORMED
 *   TickerStore        → listens to TICK_RECEIVED; O(1) Map write
 */

import type { Tick, Candle, Timeframe } from './types';

// ─── Event shapes ─────────────────────────────────────────────────────────────

/**
 * Fires when a raw tick has been normalised and validated.
 * Emitted by: adapter rawHandler after normalizer.normalizeTick() returns ok().
 * Corrupt ticks (price=0, non-finite) are dropped — this event never carries them.
 */
export interface TickReceivedEvent {
  readonly type: 'TICK_RECEIVED';
  readonly tick: Tick;
}

/**
 * Fires on every tick that updates the CURRENT (still-open) candle.
 * Emitted by: CandleAggregator.processTick() when the tick falls in the same window.
 *
 * Intended consumer: TradingView TVDataFeed (updates the live forming bar).
 * NOT intended for SignalEngine — fire signal computation only on CANDLE_FORMED.
 *
 * candle.state === 'open' always.
 */
export interface CandleUpdatedEvent {
  readonly type:      'CANDLE_UPDATED';
  readonly candle:    Candle;    // current open candle, updated OHLCV
  readonly timeframe: Timeframe;
}

/**
 * Fires exactly once when a candle window closes.
 * Emitted by: CandleAggregator.processTick() when the tick opens a new window.
 *
 * Intended consumers: RegimeEngine, SignalEngine, CandleStore.append().
 * candle.state === 'closed' always.
 */
export interface CandleFormedEvent {
  readonly type:      'CANDLE_FORMED';
  readonly candle:    Candle;    // fully closed candle — final OHLCV
  readonly timeframe: Timeframe;
}

/**
 * Fires when the adapter WebSocket opens and heartbeat is live.
 * Emitted by: AngelOneAdapter after onopen + ConnectionMonitor.startHeartbeat().
 *
 * MarketDataService listens and re-subscribes all keys from
 * SubscriptionManager.getResubscriptionList().
 */
export interface ConnectedEvent {
  readonly type:        'CONNECTED';
  readonly adapterName: string;   // "AngelOne"
  readonly timestamp:   number;   // unix ms UTC
}

/**
 * Fires when the WebSocket closes or ConnectionMonitor detects 3 missed pings.
 * Emitted by: AngelOneAdapter (onclose) or ConnectionMonitor (heartbeat timeout).
 *
 * MarketDataService listens and initiates ExponentialBackoff reconnect loop.
 */
export interface DisconnectedEvent {
  readonly type:        'DISCONNECTED';
  readonly adapterName: string;
  readonly reason:      string;   // human-readable, e.g. "heartbeat timeout", "server closed"
  readonly timestamp:   number;   // unix ms UTC
}

/**
 * Fires at the START of each reconnect attempt (before the delay wait).
 * Emitted by: MarketDataService reconnect loop.
 *
 * UI uses this to show "Reconnecting… attempt 2/5 (retry in 6s)".
 */
export interface ReconnectingEvent {
  readonly type:        'RECONNECTING';
  readonly adapterName: string;
  readonly attempt:     number;   // 1-indexed
  readonly maxAttempts: number;   // always 5 per ExponentialBackoff
  readonly delayMs:     number;   // how long we will wait before this attempt
}

/**
 * Fires when all retry attempts are exhausted.
 * Emitted by: MarketDataService reconnect loop after attempt 5 fails.
 *
 * After this event, MarketDataService transitions to a terminal disconnected
 * state. Manual reconnect (user action) is required.
 * AlertService should surface this as a CRITICAL alert.
 */
export interface ReconnectFailedEvent {
  readonly type:        'RECONNECT_FAILED';
  readonly adapterName: string;
  readonly attempts:    number;   // total attempts made (5)
  readonly timestamp:   number;   // unix ms UTC
}

/**
 * Fires when a symbol subscription fails at the adapter level.
 * Emitted by: AngelOneAdapter on token resolution failure or WS subscribe error.
 *
 * Does NOT disconnect the entire session — only the failing symbol is affected.
 */
export interface SubscriptionErrorEvent {
  readonly type:    'SUBSCRIPTION_ERROR';
  readonly symbol:  string;
  readonly error:   Error;
  readonly timestamp: number;
}

/**
 * Fires when CandleAggregator detects a gap in candle sequence.
 * e.g. exchange timestamp jumps more than 2 windows forward.
 *
 * Emitted by: CandleAggregator.processTick() on gap detection.
 * MarketDataService can trigger a historical backfill fetch in response.
 */
export interface DataGapDetectedEvent {
  readonly type:     'DATA_GAP_DETECTED';
  readonly symbol:   string;
  readonly timeframe: Timeframe;
  readonly fromMs:   number;    // unix ms UTC — expected candle start
  readonly toMs:     number;    // unix ms UTC — actual tick timestamp
}

// ─── Discriminated union ──────────────────────────────────────────────────────

export type MarketDataEvent =
  | TickReceivedEvent
  | CandleUpdatedEvent
  | CandleFormedEvent
  | ConnectedEvent
  | DisconnectedEvent
  | ReconnectingEvent
  | ReconnectFailedEvent
  | SubscriptionErrorEvent
  | DataGapDetectedEvent;

export type MarketDataEventType = MarketDataEvent['type'];

// ─── IEventBus interface ──────────────────────────────────────────────────────

export interface IEventBus {
  /**
   * Emit an event to all registered handlers for that event type.
   * Synchronous — all handlers are called before emit() returns.
   * Handler exceptions are caught and logged; they do NOT propagate to the emitter.
   */
  emit<T extends MarketDataEvent>(event: T): void;

  /**
   * Register a typed handler for a specific event type.
   * Type inference narrows the handler argument to the correct event shape.
   *
   * @returns Unsubscribe function. Call it to remove the handler.
   *          Calling unsubscribe multiple times is safe.
   */
  on<T extends MarketDataEventType>(
    eventType: T,
    handler:   (event: Extract<MarketDataEvent, { type: T }>) => void,
  ): () => void;

  /**
   * Remove a previously registered handler.
   * The handler reference must be the same object passed to on().
   * Type-safe: handler type is narrowed to the event type.
   */
  off<T extends MarketDataEventType>(
    eventType: T,
    handler:   (event: Extract<MarketDataEvent, { type: T }>) => void,
  ): void;

  /**
   * Remove all handlers for all event types.
   * Called by MarketDataService.disconnect() to prevent memory leaks.
   */
  clear(): void;

  /**
   * Returns the number of registered handlers for a given event type.
   * Useful for debugging and leak detection.
   */
  listenerCount(eventType: MarketDataEventType): number;
}
