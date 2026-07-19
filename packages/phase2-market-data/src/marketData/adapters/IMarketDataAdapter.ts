/**
 * src/marketData/adapters/IMarketDataAdapter.ts
 * Phase 2B — Inner broker adapter interface + all raw broker types.
 *
 * This interface is NEVER seen by consumers (RegimeEngine, SignalEngine, UI).
 * Only MarketDataService calls into IMarketDataAdapter.
 * Only adapters (AngelOneAdapter, ZerodhaAdapter) implement it.
 *
 * It speaks broker language:
 *   - Tokens (numeric string IDs, not canonical tickers)
 *   - Exchange type codes (1=NSE_CM, 3=BSE_CM, etc.)
 *   - Prices in paise (not rupees)
 *   - Timestamps as IST date strings (not unix ms)
 *
 * The normalizer.ts converts from these types to canonical Artha types.
 * normalizer.ts is the ONLY file that references these raw shapes downstream.
 */

import type { Result } from '../../utils/errors';
import type { Timeframe } from '../types';

// ─── Raw broker types ─────────────────────────────────────────────────────────

/**
 * A single tick as received from the broker WebSocket binary message.
 * Shape matches SmartAPI WebSocket 2.0 SNAP_QUOTE (mode 3) decoded fields.
 * Prices are in paise. Timestamps are unix ms from exchange.
 */
export interface RawTick {
  readonly token:              string;    // broker token e.g. "99926000"
  readonly exchangeType:       number;    // 1=NSE_CM, 2=NSE_FO, 3=BSE_CM, 4=BSE_FO, 5=MCX_FO
  readonly lastTradedPrice:    number;    // paise — divide by 100 for rupees
  readonly bidPrice?:          number;    // paise
  readonly askPrice?:          number;    // paise
  readonly volume:             number;    // cumulative day volume (units)
  readonly exchangeTimestamp:  number;    // unix ms from exchange (UTC)
  // SNAP_QUOTE extras — available in mode 3 only
  readonly openPrice?:         number;    // day open, paise
  readonly highPrice?:         number;    // day high, paise
  readonly lowPrice?:          number;    // day low, paise
  readonly avgTradedPrice?:    number;    // VWAP proxy, paise
  readonly totalBuyQty?:       number;
  readonly totalSellQty?:      number;
}

/**
 * A single OHLCV candle row as returned by the broker's historical REST API.
 * Shape matches SmartAPI getCandleData response: each row is [ts, o, h, l, c, v].
 * Prices are in rupees (historical REST uses rupees, unlike WebSocket which uses paise).
 * Timestamp is an IST ISO8601 string.
 */
export interface RawCandle {
  readonly timestamp: string;   // "2024-01-15T09:15:00+05:30" — IST ISO8601
  readonly open:      number;   // rupees (historical REST returns rupees, not paise)
  readonly high:      number;   // rupees
  readonly low:       number;   // rupees
  readonly close:     number;   // rupees
  readonly volume:    number;   // units
}

/**
 * A single instrument as returned by the broker's symbol search / instrument master.
 */
export interface RawSymbol {
  readonly token:           string;
  readonly symbol:          string;    // broker's ticker format (may differ from canonical)
  readonly name:            string;    // full company name
  readonly exchange:        string;    // broker's exchange string e.g. "NSE", "BSE"
  readonly instrumentType:  string;    // e.g. "EQ", "OPTIDX", "FUTIDX"
  readonly lotSize:         number;
  readonly tickSize:        number;
  readonly isin?:           string;
  readonly sector?:         string;
}

// ─── Adapter enums ────────────────────────────────────────────────────────────

/**
 * WebSocket subscription mode.
 * Determines which fields are included in the binary tick message.
 *
 * SNAP_QUOTE (mode 3) is mandatory for CandleAggregator because it provides:
 *   - Cumulative day volume (needed for delta volume per candle)
 *   - Day open/high/low (needed to seed the first candle)
 *
 * LTP (mode 1) is insufficient for candle synthesis.
 */
export type SubscriptionMode =
  | 'LTP'          // mode 1: last traded price only
  | 'QUOTE'        // mode 2: LTP + best bid/ask + volume
  | 'SNAP_QUOTE';  // mode 3: full OHLCV for the day + bid/ask + volume (REQUIRED)

/**
 * Historical candle interval strings used in the broker REST API request body.
 * These are adapter-internal — never exposed to consumers.
 * MarketDataService passes canonical Timeframe; adapter maps it via INTERVAL_MAP.
 */
export type AdapterInterval =
  | 'ONE_MINUTE'
  | 'FIVE_MINUTE'
  | 'FIFTEEN_MINUTE'
  | 'THIRTY_MINUTE'
  | 'ONE_HOUR'
  | 'ONE_DAY';

/**
 * Canonical Timeframe → AdapterInterval mapping.
 * Defined here so adapters use it without hardcoding strings.
 */
export const TIMEFRAME_TO_ADAPTER_INTERVAL: Readonly<Record<Timeframe, AdapterInterval>> = {
  '1m':  'ONE_MINUTE',
  '5m':  'FIVE_MINUTE',
  '15m': 'FIFTEEN_MINUTE',
  '30m': 'THIRTY_MINUTE',
  '1h':  'ONE_HOUR',
  '1d':  'ONE_DAY',
} as const;

// ─── Token resolution ─────────────────────────────────────────────────────────

/**
 * Result of resolving a canonical ticker to a broker-specific token.
 * Needed to form WebSocket subscription messages and REST API requests.
 */
export interface TokenInfo {
  readonly token:        string;    // broker numeric token string e.g. "99926000"
  readonly exchangeType: number;    // broker exchange type code e.g. 1 for NSE_CM
  readonly exchange:     string;    // canonical exchange string e.g. "NSE"
}

// ─── IMarketDataAdapter ───────────────────────────────────────────────────────

export interface IMarketDataAdapter {
  /**
   * Human-readable broker name. e.g. "AngelOne", "Zerodha".
   * Propagated to MarketDataService.name and all bus events.
   */
  readonly name:   string;

  /** true for live adapters, false for SimulatedProvider. */
  readonly isLive: boolean;

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Authenticate with the broker and open the WebSocket connection.
   * Returns err(AuthError) on credential failure.
   * Returns err(NetworkError) on connectivity failure.
   */
  connect(): Promise<Result<void>>;

  /**
   * Gracefully close WebSocket and invalidate session credentials.
   */
  disconnect(): Promise<void>;

  /** true only when WebSocket is OPEN and last heartbeat was acknowledged. */
  isConnected(): boolean;

  // ─── Token resolution ────────────────────────────────────────────────────────

  /**
   * Resolve a canonical ticker + exchange string to a broker token.
   * Used before every WebSocket subscription and REST historical request.
   *
   * @param ticker   Canonical ticker e.g. "RELIANCE"
   * @param exchange Canonical exchange string e.g. "NSE"
   *
   * Implementation note (Phase 3): results should be cached in memory
   * to avoid repeated instrument master lookups. Cache is invalidated on disconnect.
   */
  resolveToken(ticker: string, exchange: string): Promise<Result<TokenInfo>>;

  // ─── Real-time WebSocket ─────────────────────────────────────────────────────

  /**
   * Subscribe to raw tick updates for a token via WebSocket.
   *
   * @param token    TokenInfo from resolveToken()
   * @param mode     Must be SNAP_QUOTE for CandleAggregator compatibility
   * @param callback Fires on every binary message decoded for this token.
   *                 Callback receives the raw broker tick (paise, broker field names).
   *                 normalizer.normalizeTick() is called by the adapter before emitting
   *                 TICK_RECEIVED on the EventBus.
   *
   * @returns Unsubscribe function. Calling it sends UNSUBSCRIBE to the WebSocket.
   */
  subscribeRawTick(
    token:    TokenInfo,
    mode:     SubscriptionMode,
    callback: (raw: RawTick) => void,
  ): () => void;

  // ─── Historical REST ─────────────────────────────────────────────────────────

  /**
   * Fetch historical OHLCV candles from the broker's REST API.
   *
   * @param token    TokenInfo from resolveToken()
   * @param interval AdapterInterval (use TIMEFRAME_TO_ADAPTER_INTERVAL to map)
   * @param from     Start datetime — "YYYY-MM-DD HH:mm" in IST (broker format)
   * @param to       End datetime   — "YYYY-MM-DD HH:mm" in IST (broker format)
   *
   * NOTE: Caller is responsible for:
   *   - Formatting from/to as IST strings (normalizer provides helpers)
   *   - Paginating if the range exceeds broker limits (max ~8,000 candles per request)
   *   - Not requesting data for the current incomplete candle (CANDLE_SETTLE_MS guard)
   *
   * Returns raw RawCandle[] — normalizer.normalizeCandle() is called by the historical
   * source, not by this method.
   */
  fetchRawCandles(
    token:    TokenInfo,
    interval: AdapterInterval,
    from:     string,
    to:       string,
  ): Promise<Result<RawCandle[]>>;

  // ─── Symbol search ───────────────────────────────────────────────────────────

  /**
   * Search the broker's instrument master for matching symbols.
   * @param query Partial ticker or company name.
   * Returns raw broker symbols — normalizer.normalizeSymbol() is called by MarketDataService.
   */
  searchRawSymbols(query: string): Promise<Result<RawSymbol[]>>;
}
