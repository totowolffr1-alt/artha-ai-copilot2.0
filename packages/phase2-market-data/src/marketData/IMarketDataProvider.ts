/**
 * src/marketData/IMarketDataProvider.ts
 * Phase 2B — The simulation boundary interface.
 *
 * ALL consumers (RegimeEngine, SignalEngine, TradingView datafeed, UI hooks,
 * Backtesting) depend ONLY on this interface. They never import MarketDataService,
 * AngelOneAdapter, or any broker type directly.
 *
 * Two concrete implementations are planned:
 *   1. MarketDataService   — live data via AngelOne SmartAPI (Phase 3)
 *   2. SimulatedProvider   — replay from fixture candles (Phase 3 step 3.5)
 *
 * Swapping live ↔ simulated = one dependency injection change.
 */

import type { Candle, Tick, Symbol, Timeframe } from './types';
import type { Result } from '../utils/errors';

export interface IMarketDataProvider {
  /**
   * Human-readable adapter name. e.g. "AngelOne", "Simulated".
   * Displayed in the UI status bar.
   */
  readonly name: string;

  /**
   * true  → connected to a live exchange feed.
   * false → replaying fixtures (backtest / simulation mode).
   * Consumers use this to suppress live-only UI elements.
   */
  readonly isLive: boolean;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Establish connection to the data source.
   * For live: authenticates + opens WebSocket.
   * For simulated: loads fixture files into memory.
   * Returns err(AuthError) on invalid credentials.
   * Returns err(NetworkError) on connectivity failure.
   * Idempotent: calling connect() on an already-connected provider is a no-op ok().
   */
  connect(): Promise<Result<void>>;

  /**
   * Gracefully close all connections and release resources.
   * All active subscriptions are silently unregistered — callbacks will not fire
   * after disconnect() resolves.
   */
  disconnect(): Promise<void>;

  /**
   * Synchronous connection state check.
   * true only when the underlying transport is open and heartbeat is alive.
   */
  isConnected(): boolean;

  // ─── Historical data ───────────────────────────────────────────────────────

  /**
   * Fetch historical OHLCV candles for a symbol and timeframe.
   *
   * @param symbol    Canonical ticker e.g. "RELIANCE", "NIFTY50"
   * @param timeframe One of the supported Timeframe literals
   * @param from      Start of range — unix ms UTC (inclusive)
   * @param to        End of range   — unix ms UTC (inclusive)
   *
   * Returns candles sorted by timestamp ascending.
   * Returns err(HistoricalDataError) on network or parse failure.
   * Never throws — all failures are encoded as Result.
   *
   * Implementation note (live provider):
   *   Tries DB cache first. Falls back to REST API. Writes REST result back to DB.
   *   Does NOT include the current incomplete candle (CANDLE_SETTLE_MS guard).
   */
  fetchCandles(
    symbol:    string,
    timeframe: Timeframe,
    from:      number,
    to:        number,
  ): Promise<Result<Candle[]>>;

  // ─── Symbol lookup ─────────────────────────────────────────────────────────

  /**
   * Full-text search across the instrument master.
   * @param query Partial ticker or company name — min 2 chars recommended.
   * Returns up to 20 matches, sorted by relevance.
   * Returns err(NetworkError) if the instrument master is unavailable.
   */
  searchSymbols(query: string): Promise<Result<Symbol[]>>;

  /**
   * Exact lookup by canonical ticker.
   * Returns err(ValidationError) if ticker is not found.
   */
  getSymbol(ticker: string): Promise<Result<Symbol>>;

  // ─── Real-time subscriptions ───────────────────────────────────────────────

  /**
   * Subscribe to tick-level price updates for a symbol.
   *
   * @param symbol   Canonical ticker
   * @param callback Fires on every SNAP_QUOTE tick from the exchange.
   *                 Callback receives a validated, normalised Tick (price in rupees,
   *                 timestamp in unix ms UTC). Will never receive a corrupt tick.
   *
   * Returns an unsubscribe function. Call it to stop receiving callbacks.
   * Calling unsubscribe() multiple times is safe (idempotent).
   *
   * If the provider is disconnected: returns a no-op unsubscribe and does NOT
   * throw. Callbacks resume automatically after reconnection.
   *
   * Multiple callers subscribing to the same symbol each receive their own
   * callbacks. The underlying adapter subscription is ref-counted — only one
   * WebSocket subscription is created per symbol regardless of caller count.
   */
  subscribeTick(
    symbol:   string,
    callback: (tick: Tick) => void,
  ): () => void;

  /**
   * Subscribe to formed (closed) candles for a symbol and timeframe.
   *
   * @param symbol    Canonical ticker
   * @param timeframe Granularity of candles to receive
   * @param callback  Fires exactly once per candle close.
   *                  Candle.state will be 'closed'.
   *                  Signal engines should listen here (not to CANDLE_UPDATED).
   *
   * Returns an unsubscribe function. Same ref-counting semantics as subscribeTick.
   *
   * Implementation note:
   *   1m candles are synthesised from SNAP_QUOTE ticks by CandleAggregator.
   *   5m/15m/30m/1h candles are aggregated from closed 1m candles.
   *   1d candles close at 15:30 IST.
   */
  subscribeCandle(
    symbol:    string,
    timeframe: Timeframe,
    callback:  (candle: Candle) => void,
  ): () => void;
}
