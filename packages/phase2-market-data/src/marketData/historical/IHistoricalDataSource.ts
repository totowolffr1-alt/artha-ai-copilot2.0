/**
 * src/marketData/historical/IHistoricalDataSource.ts
 * Phase 2B — Historical data source interface.
 *
 * MarketDataService.fetchCandles() resolves requests via an ordered chain:
 *   [0] CandleRepositorySource  — DB cache (microseconds, already validated)
 *   [1] AngelOneHistoricalSource — SmartAPI REST (hundreds of ms, rate-limited)
 *   [2] SimulatedHistoricalSource — fixture files (for tests / backtesting)
 *
 * Chain logic: try [0]. On miss, try [1]. Cache [1] result into DB for future hits.
 * Sources never throw — all failures encoded as Result.
 *
 * IMPORTANT: hasData() is intentionally removed from this interface.
 * The previous design had a race between hasData() and fetchCandles().
 * Instead, fetchCandles() returns ok([]) on a guaranteed miss (empty range),
 * and the chain interprets an empty ok([]) as "try next source".
 */

import type { Candle, Timeframe } from '../types';
import type { Result } from '../../utils/errors';

// ─── Fetch options ────────────────────────────────────────────────────────────

export interface FetchCandlesOptions {
  readonly symbol:    string;
  readonly timeframe: Timeframe;
  readonly from:      number;    // unix ms UTC — inclusive
  readonly to:        number;    // unix ms UTC — inclusive
  /**
   * If true, the source should NOT include the currently-incomplete candle.
   * Applied by AngelOneHistoricalSource via the CANDLE_SETTLE_MS guard.
   * Default: true (safe default — never return incomplete candles from REST).
   */
  readonly excludeIncomplete?: boolean;
}

// ─── Pagination contract ──────────────────────────────────────────────────────

/**
 * SmartAPI getCandleData constraints (enforced by AngelOneHistoricalSource).
 * Placed here so other sources know the expected pagination behaviour.
 */
export const SMARTAPI_HISTORICAL_LIMITS = {
  /** Maximum candles returned per single REST request. */
  MAX_CANDLES_PER_REQUEST: 8_000,
  /**
   * Maximum date range per request per timeframe (approximate, in days).
   * Smaller timeframes have shorter max ranges due to the 8,000-candle cap.
   */
  MAX_RANGE_DAYS: {
    '1m':  30,
    '5m':  60,
    '15m': 90,
    '30m': 180,
    '1h':  365,
    '1d':  2000,
  } as const,
  /**
   * SmartAPI last-candle settlement lag in ms.
   * Historical endpoint data for the last 1–2 candles may have incorrect close.
   * AngelOneHistoricalSource must not request data newer than (now - CANDLE_SETTLE_MS).
   */
  CANDLE_SETTLE_MS: 5_000,
} as const;

// ─── IHistoricalDataSource ────────────────────────────────────────────────────

export interface IHistoricalDataSource {
  /**
   * Human-readable source name. e.g. "DB", "AngelOne", "Fixture".
   * Used in logging and error messages.
   */
  readonly name: string;

  /**
   * Fetch historical candles for the given options.
   *
   * Return semantics (chain contract):
   *   ok(Candle[])  where array.length > 0 → source has data, chain stops here
   *   ok([])                               → source has no data, chain tries next source
   *   err(MarketDataError)                 → fetch failed, chain tries next source
   *                                          (implementation may also stop chain on
   *                                           fatal errors like AuthError)
   *
   * Candles must be sorted by timestamp ascending.
   * Candles must have Candle.state === 'closed'.
   * Partial coverage is acceptable — return what is available.
   *   The next source in the chain fills gaps.
   */
  fetchCandles(options: FetchCandlesOptions): Promise<Result<Candle[]>>;

  /**
   * Write candles into this source's backing store.
   * Used by MarketDataService to cache REST results into the DB after fetching.
   *
   * No-op for read-only sources (SimulatedHistoricalSource, fixtures).
   * Returns ok(count) where count is number of candles successfully written.
   * Returns err() on storage failure — caller should log but not abort.
   */
  cacheCandles(candles: readonly Candle[]): Promise<Result<number>>;
}
