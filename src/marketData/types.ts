/**
 * src/marketData/types.ts
 * Phase 2B — Canonical domain types. Broker-agnostic.
 *
 * Rules:
 *   - All prices in rupees (never paise).
 *   - All timestamps unix ms UTC (never IST strings).
 *   - All volumes in units (never lots, unless noted).
 *   - These types cross module boundaries freely; raw broker types never do.
 */

// ─── Primitives ───────────────────────────────────────────────────────────────

/**
 * Supported timeframes. Expressed as string literals so they survive JSON
 * serialisation and can be used as Map keys without conversion.
 */
export type Timeframe =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '1d';

/**
 * Supported exchanges. Canonical string — never a broker numeric code.
 */
export type Exchange =
  | 'NSE'   // NSE Cash Market (equities)
  | 'BSE'   // BSE Cash Market
  | 'NFO'   // NSE Futures & Options
  | 'BFO'   // BSE Futures & Options
  | 'MCX'   // Multi Commodity Exchange
  | 'CDS';  // Currency Derivatives Segment

/**
 * Canonical asset classification.
 */
export type AssetType =
  | 'equity'
  | 'index'
  | 'futures'
  | 'options'
  | 'commodity'
  | 'currency'
  | 'etf';

/**
 * Candle state — whether the candle is still forming or has closed.
 * Used by CandleAggregator to distinguish CANDLE_UPDATED from CANDLE_FORMED.
 */
export type CandleState = 'open' | 'closed';

// ─── Candle ───────────────────────────────────────────────────────────────────

/**
 * A single OHLCV candle. Immutable after formation.
 *
 * Invariants (enforced by normalizer):
 *   high >= open, high >= close, high >= low
 *   low  <= open, low  <= close
 *   high >= low >= 0
 *   volume >= 0
 *   timestamp > 0 (unix ms UTC, start of the candle window)
 */
export interface Candle {
  readonly symbol:    string;       // canonical ticker e.g. "RELIANCE", "NIFTY50"
  readonly exchange:  Exchange;
  readonly timeframe: Timeframe;
  readonly timestamp: number;       // unix ms UTC — start of candle window
  readonly open:      number;       // rupees
  readonly high:      number;       // rupees
  readonly low:       number;       // rupees
  readonly close:     number;       // rupees
  readonly volume:    number;       // units traded in this candle window (delta, not cumulative)
  readonly state:     CandleState;  // 'open' = still forming, 'closed' = final
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

/**
 * A single real-time price update from the exchange.
 * Produced by normalizer from a broker binary WebSocket message.
 *
 * Invariants (enforced by normalizer):
 *   price > 0
 *   volume >= 0
 *   bid < ask (when both present)
 *   timestamp > 0 (unix ms UTC, from exchange)
 */
export interface Tick {
  readonly symbol:          string;
  readonly exchange:        Exchange;
  readonly timestamp:       number;     // unix ms UTC — exchange timestamp
  readonly price:           number;     // last traded price, rupees
  readonly bid?:            number;     // best bid, rupees
  readonly ask?:            number;     // best ask, rupees
  readonly volume:          number;     // cumulative day volume (from SNAP_QUOTE)
  // Intraday OHLC — available in SNAP_QUOTE mode, used to seed first candle
  readonly openPrice?:      number;     // day open, rupees
  readonly highPrice?:      number;     // day high, rupees
  readonly lowPrice?:       number;     // day low, rupees
  readonly avgTradedPrice?: number;     // VWAP proxy, rupees
}

// ─── Symbol ───────────────────────────────────────────────────────────────────

/**
 * A tradable instrument as known to Artha.
 * Returned by searchSymbols() and getSymbol().
 * Broker token is NOT exposed here — that lives in TokenInfo inside the adapter.
 */
export interface Symbol {
  readonly ticker:          string;     // canonical ticker e.g. "RELIANCE"
  readonly name:            string;     // full name e.g. "Reliance Industries Ltd"
  readonly exchange:        Exchange;
  readonly assetType:       AssetType;
  readonly isin?:           string;
  readonly lotSize:         number;     // 1 for equities, N for derivatives
  readonly tickSize:        number;     // minimum price movement, rupees
  readonly sector?:         string;     // e.g. "Energy", "Banking"
  readonly isActive:        boolean;    // false if delisted or suspended
}

// ─── Timeframe utilities (pure constants, no logic) ──────────────────────────

/**
 * Window size in milliseconds for each timeframe.
 * Used by CandleAggregator for boundary detection.
 *
 * NOTE: '1d' is NOT a simple ms multiple — NSE session starts 09:15 IST.
 * CandleAggregator handles '1d' boundaries explicitly, not via this map.
 */
export const TIMEFRAME_MS: Readonly<Record<Exclude<Timeframe, '1d'>, number>> = {
  '1m':  60_000,
  '5m':  300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h':  3_600_000,
} as const;

/**
 * IST offset from UTC in milliseconds.
 * Used for candle boundary alignment: Math.floor((tsMs + IST_OFFSET_MS) / windowMs)
 * CRITICAL: subtract this same offset when converting back to unix ms UTC.
 */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000; // +05:30 = 19_800_000 ms

/**
 * NSE session boundaries in IST, expressed as minutes-from-midnight.
 * Pre-open: 09:00–09:08. Session: 09:15–15:30.
 */
export const NSE_SESSION = {
  PRE_OPEN_START_IST_MIN:  9 * 60,          //  9:00
  SESSION_START_IST_MIN:   9 * 60 + 15,     //  9:15
  SESSION_END_IST_MIN:    15 * 60 + 30,     // 15:30
} as const;

/**
 * All supported timeframes as a readonly tuple — useful for iteration/validation.
 */
export const ALL_TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '1d'] as const;

/**
 * All supported exchanges as a readonly tuple.
 */
export const ALL_EXCHANGES: readonly Exchange[] = ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS'] as const;
