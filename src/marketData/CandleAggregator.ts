/**
 * src/marketData/CandleAggregator.ts
 * Phase 2B — CandleAggregator interface + aggregation boundary constants.
 *
 * Reason this exists: SmartAPI WebSocket 2.0 delivers SNAP_QUOTE ticks, not
 * formed candles. 1m candles must be synthesised from the tick stream.
 * Higher timeframes (5m, 15m, 30m, 1h) are built by aggregating 1m candles.
 * 1d candles close at 15:30 IST each session.
 *
 * SINGLE SOURCE OF TRUTH for "what is the current open candle OHLCV".
 * No other component may synthesise candle data from ticks.
 *
 * Volume semantics (critical):
 *   SmartAPI SNAP_QUOTE provides CUMULATIVE day volume, not per-tick increments.
 *   Delta volume per candle = tick.volume - previousCandleClose.volume
 *   The aggregator maintains a per-symbol baseline volume for this computation.
 */

import type { Tick, Candle, Timeframe } from './types';

// ─── Candle window state ──────────────────────────────────────────────────────

/**
 * Internal state of one open candle window.
 * Maintained per (symbol, timeframe) pair inside the aggregator.
 * Not exposed to consumers — closed candles are emitted as Candle via EventBus.
 */
export interface OpenCandleWindow {
  readonly symbol:         string;
  readonly timeframe:      Timeframe;
  readonly windowStartMs:  number;    // unix ms UTC — start of this candle window (IST-aligned)
  open:                    number;    // set on first tick; never changes within window
  high:                    number;    // running maximum
  low:                     number;    // running minimum
  close:                   number;    // updated on every tick
  baselineVolume:          number;    // cumulative day volume at start of this window
  volume:                  number;    // delta volume so far (= latestTick.volume - baselineVolume)
  tickCount:               number;    // number of ticks processed in this window
}

// ─── Aggregation boundary helpers (pure constants) ───────────────────────────

/**
 * Compute the IST-aligned candle window start time for a given tick timestamp.
 *
 * IMPORTANT: floor must be done in IST space to align with exchange session.
 * Formula: Math.floor((tsMs + IST_OFFSET_MS) / windowMs) * windowMs - IST_OFFSET_MS
 *
 * This function signature is the contract. Implementation lives in Phase 3.
 */
export type CandleWindowStartFn = (tsMs: number, timeframe: Exclude<Timeframe, '1d'>) => number;

// ─── Seeding contract ─────────────────────────────────────────────────────────

/**
 * Historical candles used to seed the aggregator before first tick arrives.
 * Ensures volume baseline is correct and first live candle has valid open.
 */
export interface AggregatorSeedOptions {
  readonly candles:    readonly Candle[];
  readonly timeframe:  Timeframe;
  /**
   * If true, the last candle in the array is treated as the current open window.
   * Its volume becomes the baseline for delta computation.
   * Default: false (all candles treated as closed history).
   */
  readonly lastIsOpen?: boolean;
}

// ─── ICandleAggregator ────────────────────────────────────────────────────────

export interface ICandleAggregator {
  /**
   * Process a single validated tick.
   *
   * Decision logic:
   *   A) Same window as current open candle:
   *      → Update high/low/close/volume on OpenCandleWindow
   *      → Emit CANDLE_UPDATED via EventBus
   *
   *   B) New window (tick.timestamp falls outside current window):
   *      → Close current window: emit CANDLE_FORMED (candle.state = 'closed')
   *      → CandleStore.append(closedCandle)
   *      → Open new window: open = high = low = close = tick.price, volume = 0
   *      → Emit CANDLE_UPDATED for the new (empty) open candle
   *
   *   C) Pre-open tick (before NSE_SESSION.SESSION_START_IST_MIN):
   *      → Tick is silently dropped. Pre-open auction data is excluded.
   *
   *   D) Gap detected (new window is ≥ 2 windows ahead of current):
   *      → Emit DATA_GAP_DETECTED via EventBus
   *      → Close current window (may have incomplete data)
   *      → Open new window at tick's window start
   *
   * Called by MarketDataService on every TICK_RECEIVED event.
   */
  processTick(tick: Tick): void;

  /**
   * Returns the currently open (not yet closed) candle for a symbol+timeframe.
   * Returns undefined if no ticks have been received for this pair yet.
   * candle.state === 'open' always.
   */
  getCurrentCandle(symbol: string, timeframe: Timeframe): Candle | undefined;

  /**
   * Seed historical candles before live tick stream begins.
   * Must be called before the first processTick() for each timeframe.
   *
   * Purpose:
   *   1. Sets volume baseline (prevents first candle having wrong delta volume).
   *   2. Provides correct open price if the session started before connection.
   *   3. Enables higher-timeframe aggregation immediately without waiting for
   *      enough 1m candles to accumulate.
   *
   * Calling seed() after processTick() has started is allowed but may cause
   * a transient volume discontinuity. Caller should avoid this.
   */
  seed(options: AggregatorSeedOptions): void;

  /**
   * All symbols currently being tracked (have received at least one tick).
   */
  trackedSymbols(): readonly string[];

  /**
   * All timeframes being aggregated for a given symbol.
   */
  activeTimeframes(symbol: string): readonly Timeframe[];

  /**
   * Release all state for a symbol. Called when SubscriptionManager ref count → 0.
   * Emits CANDLE_FORMED for the current open window if it has received ticks.
   */
  evict(symbol: string): void;

  /**
   * Release all state. Called on disconnect().
   */
  clear(): void;
}
