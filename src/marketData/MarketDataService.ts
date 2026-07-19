/**
 * src/marketData/MarketDataService.ts
 * Phase 2B — MarketDataService class shape.
 *
 * Implements IMarketDataProvider. The single public entry point for all consumers.
 * Orchestrates: adapter, stores, aggregator, bus, subscriptions, historical chain.
 *
 * All method bodies are deferred to Phase 3 (implementation phase).
 * This file establishes:
 *   - Constructor dependency injection contract
 *   - Method signatures (must match IMarketDataProvider exactly)
 *   - Internal wiring comments that Phase 3 will implement
 *
 * Layering rules enforced by this file:
 *   - Does NOT import from AngelOneAdapter (receives IMarketDataAdapter)
 *   - Does NOT import from any consumer (RegimeEngine, SignalEngine, UI hooks)
 *   - Does NOT export EventBus (internal wire only)
 *   - Receives IHistoricalDataSource[] as an ordered chain (DI, not hardcoded)
 */

import type { IMarketDataProvider } from './IMarketDataProvider';
import type { IMarketDataAdapter }  from './adapters/IMarketDataAdapter';
import type { ISubscriptionManager } from './SubscriptionManager';
import type { ICandleAggregator }   from './CandleAggregator';
import type { IEventBus }           from './EventBus';
import type { IHistoricalDataSource } from './historical/IHistoricalDataSource';
import type { Candle, Tick, Symbol, Timeframe } from './types';
import type { Result } from '../utils/errors';

// ─── MarketDataService ────────────────────────────────────────────────────────

export class MarketDataService implements IMarketDataProvider {
  /**
   * Propagated from the injected adapter.
   * e.g. "AngelOne" or "Simulated".
   */
  readonly name:   string;

  /**
   * Propagated from the injected adapter.
   * true for live brokers, false for SimulatedProvider.
   */
  readonly isLive: boolean;

  /**
   * All dependencies are constructor-injected.
   * Swapping AngelOneAdapter → ZerodhaAdapter = one argument change.
   * Swapping live → simulated = one argument change.
   * Zero code inside this class changes in either case.
   *
   * @param adapter       The broker-specific adapter (AngelOne, Zerodha, Simulated)
   * @param subscriptions Ref-counted subscription tracker
   * @param aggregator    Tick-to-candle synthesis engine
   * @param bus           Internal typed event emitter
   * @param historical    Ordered chain of historical data sources [DB, REST, Fixture]
   */
  constructor(
    private readonly adapter:       IMarketDataAdapter,
    private readonly subscriptions: ISubscriptionManager,
    private readonly aggregator:    ICandleAggregator,
    private readonly bus:           IEventBus,
    private readonly historical:    readonly IHistoricalDataSource[],
  ) {
    this.name   = adapter.name;
    this.isLive = adapter.isLive;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Phase 3 implementation will:
   *   1. adapter.connect()  — authenticate + open WebSocket
   *   2. On CONNECTED bus event: re-subscribe from subscriptions.getResubscriptionList()
   *   3. Start reconnect loop listener on DISCONNECTED bus event
   */
  connect(): Promise<Result<void>> {
    throw new Error('Not implemented — Phase 3');
  }

  /**
   * Phase 3 implementation will:
   *   1. bus.clear()            — remove all internal handlers
   *   2. aggregator.clear()     — release all OHLCV windows
   *   3. subscriptions.clear()  — reset ref counts
   *   4. adapter.disconnect()   — close WebSocket
   */
  disconnect(): Promise<void> {
    throw new Error('Not implemented — Phase 3');
  }

  isConnected(): boolean {
    throw new Error('Not implemented — Phase 3');
  }

  // ─── Historical data ────────────────────────────────────────────────────────

  /**
   * Phase 3 implementation will:
   *   1. Walk this.historical[] in order
   *   2. Call source.fetchCandles(options)
   *   3. On ok([]) or err(): try next source
   *   4. On ok(candles) with candles.length > 0: cache into all prior sources, return
   *   5. After chain exhausted with no data: return err(HistoricalDataError)
   */
  fetchCandles(
    symbol:    string,
    timeframe: Timeframe,
    from:      number,
    to:        number,
  ): Promise<Result<Candle[]>> {
    throw new Error('Not implemented — Phase 3');
  }

  // ─── Symbol lookup ──────────────────────────────────────────────────────────

  /**
   * Phase 3: adapter.searchRawSymbols(query) → normalizer.normalizeSymbol() each result.
   */
  searchSymbols(query: string): Promise<Result<Symbol[]>> {
    throw new Error('Not implemented — Phase 3');
  }

  /**
   * Phase 3: adapter.searchRawSymbols(ticker) → find exact match → normalizeSymbol().
   */
  getSymbol(ticker: string): Promise<Result<Symbol>> {
    throw new Error('Not implemented — Phase 3');
  }

  // ─── Real-time subscriptions ────────────────────────────────────────────────

  /**
   * Phase 3 implementation will:
   *   1. subscriptions.acquire({ kind: 'tick', symbol })
   *      → true:  adapter.resolveToken() + adapter.subscribeRawTick()
   *      → false: callback registered only, no adapter call
   *   2. Store callback keyed by symbol
   *   3. Listen on bus TICK_RECEIVED → fire registered callbacks for that symbol
   *   4. Return unsubscribe fn: subscriptions.release() → adapter unsubscribe if count=0
   *
   * If disconnected: returns no-op unsubscribe, does not throw.
   */
  subscribeTick(
    symbol:   string,
    callback: (tick: Tick) => void,
  ): () => void {
    throw new Error('Not implemented — Phase 3');
  }

  /**
   * Phase 3 implementation will:
   *   1. subscriptions.acquire({ kind: 'candle', symbol, timeframe })
   *      → true:  ensure tick subscription exists for this symbol (CandleAggregator needs ticks)
   *      → false: callback registered only
   *   2. Listen on bus CANDLE_FORMED for (symbol, timeframe) → fire registered callbacks
   *   3. Return unsubscribe fn with same ref-count semantics as subscribeTick
   */
  subscribeCandle(
    symbol:    string,
    timeframe: Timeframe,
    callback:  (candle: Candle) => void,
  ): () => void {
    throw new Error('Not implemented — Phase 3');
  }
}
