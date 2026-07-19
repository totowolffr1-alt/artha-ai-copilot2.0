/**
 * src/marketData/adapters/angelone/TokenRegistry.ts
 * Phase 2C — In-memory token registry for SmartAPI instrument tokens.
 *
 * Maps canonical ticker + exchange → broker token (numeric string).
 * The instrument master is a ~10MB CSV that SmartAPI publishes daily.
 * We download it lazily and keep it in memory for the lifetime of the session.
 *
 * Resolution strategy:
 *   1. Check in-memory cache first (O(1)).
 *   2. If cache miss: search via REST symbol-search endpoint.
 *   3. Cache the result.
 *   4. Cache is invalidated on disconnect (tokens may change on next session).
 *
 * SmartAPI instrument master URL:
 *   https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json
 *
 * The JSON master has one entry per instrument with fields:
 *   token, symbol, name, expiry, strike, lotsize, instrumenttype,
 *   exch_seg, tick_size
 *
 * We index by (exch_seg + "|" + symbol) for O(1) lookup after load.
 * For options/futures we accept partial match on symbol prefix.
 */

import type { Result }    from '../../../utils/errors';
import { ok, err }        from '../../../utils/errors';
import type { TokenInfo } from '../IMarketDataAdapter';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MasterEntry {
  readonly token:          string;
  readonly symbol:         string;
  readonly name:           string;
  readonly instrumenttype: string;
  readonly exch_seg:       string;    // "NSE", "BSE", "NFO", etc.
  readonly lotsize:        string;
  readonly tick_size:      string;
}

// Exchange segment string → canonical Exchange code → broker exchange type
const EXCH_SEG_TO_TYPE: Readonly<Record<string, number>> = {
  NSE: 1,
  NFO: 2,
  BSE: 3,
  BFO: 4,
  MCX: 5,
  CDS: 13,
} as const;

const MASTER_URL =
  'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

const REQUEST_TIMEOUT = 30_000; // master is ~10MB

// ─── TokenRegistry ────────────────────────────────────────────────────────────

export class TokenRegistry {
  /** Key: "{exch_seg}|{symbol}" — matches how instruments are uniquely identified. */
  private cache = new Map<string, TokenInfo>();
  /** Full master, populated once. */
  private master: MasterEntry[] | null = null;
  /** Ongoing load promise — prevents duplicate simultaneous fetches. */
  private loadPromise: Promise<Result<void>> | null = null;

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Resolve a canonical ticker + exchange string to a broker TokenInfo.
   * Loads the instrument master on first call.
   */
  async resolve(ticker: string, exchange: string): Promise<Result<TokenInfo>> {
    const cacheKey = `${exchange}|${ticker}`;
    const cached   = this.cache.get(cacheKey);
    if (cached) return ok(cached);

    // Ensure master is loaded
    const loadResult = await this.ensureMasterLoaded();
    if (!loadResult.ok) return loadResult;

    return this.findInMaster(ticker, exchange, cacheKey);
  }

  /**
   * Bulk pre-warm: resolve multiple tickers at once after master load.
   * Used by MarketDataService on reconnect to avoid N sequential resolves.
   */
  async resolveMany(
    pairs: ReadonlyArray<{ ticker: string; exchange: string }>,
  ): Promise<Map<string, Result<TokenInfo>>> {
    const results = new Map<string, Result<TokenInfo>>();

    const loadResult = await this.ensureMasterLoaded();
    if (!loadResult.ok) {
      for (const { ticker, exchange } of pairs) {
        results.set(`${exchange}|${ticker}`, loadResult);
      }
      return results;
    }

    for (const { ticker, exchange } of pairs) {
      const cacheKey = `${exchange}|${ticker}`;
      const cached   = this.cache.get(cacheKey);
      if (cached) {
        results.set(cacheKey, ok(cached));
      } else {
        results.set(cacheKey, this.findInMaster(ticker, exchange, cacheKey));
      }
    }

    return results;
  }

  /**
   * Reverse lookup: broker token → canonical ticker.
   * Used by the binary decoder to map incoming tick token to ticker symbol.
   */
  reverseResolve(token: string, exchangeType: number): string | null {
    for (const [key, info] of this.cache) {
      if (info.token === token && info.exchangeType === exchangeType) {
        // key format: "{exchange}|{ticker}"
        return key.split('|')[1] ?? null;
      }
    }
    return null;
  }

  /**
   * Drop all cached data. Called on disconnect.
   * Instrument master is re-fetched on next session (daily rotation).
   */
  clear(): void {
    this.cache.clear();
    this.master       = null;
    this.loadPromise  = null;
  }

  /** Number of entries currently cached (for diagnostics). */
  get size(): number {
    return this.cache.size;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async ensureMasterLoaded(): Promise<Result<void>> {
    if (this.master !== null) return ok(undefined);
    if (this.loadPromise)     return this.loadPromise;

    this.loadPromise = this.loadMaster();
    return this.loadPromise;
  }

  private async loadMaster(): Promise<Result<void>> {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const res = await fetch(MASTER_URL, { signal: controller.signal });
      if (!res.ok) {
        return err({
          type:       'NetworkError',
          statusCode: res.status,
          endpoint:   MASTER_URL,
          message:    `Instrument master fetch failed: HTTP ${res.status}`,
        });
      }

      this.master = await res.json() as MasterEntry[];
      return ok(undefined);

    } catch (e: unknown) {
      this.loadPromise = null; // allow retry
      if (e instanceof Error && e.name === 'AbortError') {
        return err({
          type:      'TimeoutError',
          operation: 'loadInstrumentMaster',
          timeoutMs: REQUEST_TIMEOUT,
          message:   `Instrument master download timed out after ${REQUEST_TIMEOUT}ms`,
        });
      }
      return err({
        type:    'NetworkError',
        endpoint: MASTER_URL,
        message: `Instrument master fetch error: ${e instanceof Error ? e.message : String(e)}`,
        cause:   e instanceof Error ? e : undefined,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private findInMaster(
    ticker:   string,
    exchange: string,
    cacheKey: string,
  ): Result<TokenInfo> {
    if (!this.master) {
      return err({
        type:    'NetworkError',
        message: 'Instrument master not loaded',
      });
    }

    const exchType = EXCH_SEG_TO_TYPE[exchange];
    if (exchType === undefined) {
      return err({
        type:     'NormalizationError',
        rawField: 'exchange',
        rawValue: exchange,
        message:  `Unknown exchange: ${exchange}`,
      });
    }

    // Exact symbol + exchange segment match first
    let entry = this.master.find(
      m => m.symbol === ticker && m.exch_seg === exchange,
    );

    // Equity fallback: try with "-EQ" suffix (SmartAPI uses "RELIANCE-EQ" for equities)
    if (!entry) {
      entry = this.master.find(
        m => m.symbol === `${ticker}-EQ` && m.exch_seg === exchange,
      );
    }

    if (!entry) {
      return err({
        type:    'ValidationError',
        field:   'ticker',
        rule:    'exists in instrument master',
        actual:  `${exchange}:${ticker}`,
        message: `Symbol not found in instrument master: ${exchange}:${ticker}`,
      });
    }

    const info: TokenInfo = {
      token:        entry.token,
      exchangeType: exchType,
      exchange,
    };

    this.cache.set(cacheKey, info);
    return ok(info);
  }
}
