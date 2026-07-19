/**
 * src/marketData/adapters/angelone/BinaryDecoder.ts
 * Phase 2C — SmartAPI WebSocket 2.0 binary message decoder.
 *
 * SmartAPI sends binary ArrayBuffer messages with a fixed header followed by
 * mode-specific payload. This decoder handles SNAP_QUOTE (mode 3) only,
 * which is the only mode CandleAggregator accepts.
 *
 * Binary layout (SmartAPI WebSocket 2.0 SNAP_QUOTE, all values little-endian):
 *
 *  Offset  Size  Type    Field
 *  ──────  ────  ──────  ──────────────────────────────────────────────────
 *   0       1    uint8   subscription_mode   (1=LTP, 2=QUOTE, 3=SNAP_QUOTE)
 *   1       1    uint8   exchange_type       (1=NSE_CM, 2=NSE_FO, 3=BSE_CM …)
 *   2      25    char[]  token               (null-padded ASCII string)
 *  27       8    int64   sequence_number
 *  35       8    int64   exchange_timestamp  (unix ms from exchange)
 *  43       8    int64   last_traded_price   (paise)
 *  51       8    int64   subscription_mode_val (echoes mode)
 *  ── QUOTE fields (present in mode 2+) ───────────────────────────────────
 *  59       8    int64   last_traded_qty
 *  67       8    int64   avg_traded_price    (paise)
 *  75       8    int64   volume_trade_for_the_day
 *  83       8    int64   total_buy_qty       (float64 in docs, cast to int)
 *  91       8    int64   total_sell_qty
 *  ── SNAP_QUOTE fields (present in mode 3 only) ──────────────────────────
 *  99       8    int64   open_price_of_the_day   (paise)
 * 107       8    int64   high_price_of_the_day   (paise)
 * 115       8    int64   low_price_of_the_day    (paise)
 * 123       8    int64   closed_price            (prev day close, paise)
 * 131      20    bytes   best_5_buy_data[0]      (unused for our purposes)
 * …        …    …       (best 5 bid/ask data — we skip to bid/ask summary)
 * 271       8    int64   upper_circuit_limit     (paise)
 * 279       8    int64   lower_circuit_limit     (paise)
 * 287       8    int64   52_week_high_price      (paise)
 * 295       8    int64   52_week_low_price       (paise)
 *
 * Best 5 bid/ask: offsets 131–270. Each entry is 20 bytes:
 *   flag(2) + qty(8) + price(8) + orders(2). We read only entry[0] bid/ask.
 *   Bid entry[0] starts at 131 (buy side), Ask entry[0] at 231 (sell side).
 *
 * Note: SmartAPI docs show float64 for some fields but the wire format is
 * int64 for price fields and the unit is consistently paise for mode 3.
 * bid/ask are derived from best_5 data, not a dedicated field.
 */

import type { RawTick } from '../IMarketDataAdapter';

// ─── Offsets ─────────────────────────────────────────────────────────────────

const OFF_MODE           = 0;
const OFF_EXCHANGE_TYPE  = 1;
const OFF_TOKEN          = 2;   // 25 bytes
const OFF_EXCHANGE_TS    = 35;
const OFF_LTP            = 43;
// QUOTE fields
const OFF_AVG_PRICE      = 67;
const OFF_VOLUME         = 75;
const OFF_TOTAL_BUY_QTY  = 83;
const OFF_TOTAL_SELL_QTY = 91;
// SNAP_QUOTE fields
const OFF_OPEN           = 99;
const OFF_HIGH           = 107;
const OFF_LOW            = 115;
// Best 5 bid/ask
const OFF_BEST_BID_PRICE = 139;  // buy side entry[0]: flag(2)+qty(8) = offset 131+10
const OFF_BEST_ASK_PRICE = 239;  // sell side entry[0]: 131+100+10
const MIN_SNAP_LEN       = 303;  // minimum buffer length for SNAP_QUOTE

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read a signed 64-bit little-endian integer from a DataView.
 * JavaScript BigInt required for correctness; returned as number (safe for paise < 2^53).
 */
function readInt64LE(view: DataView, offset: number): number {
  const lo = view.getUint32(offset,     true);
  const hi = view.getInt32 (offset + 4, true);
  // Combine: hi * 2^32 + lo
  return hi * 0x1_0000_0000 + lo;
}

/**
 * Read null-padded ASCII string from buffer.
 */
function readToken(view: DataView, offset: number, maxLen: number): string {
  let str = '';
  for (let i = 0; i < maxLen; i++) {
    const b = view.getUint8(offset + i);
    if (b === 0) break;
    str += String.fromCharCode(b);
  }
  return str.trim();
}

// ─── Public decoder ───────────────────────────────────────────────────────────

export interface DecodeResult {
  readonly raw:   RawTick;
  readonly mode:  number;
}

export interface DecodeError {
  readonly reason: string;
  readonly bufLen: number;
}

/**
 * Decode a SmartAPI WebSocket 2.0 binary ArrayBuffer into a RawTick.
 *
 * Returns { ok: true, raw, mode } on success.
 * Returns { ok: false, reason } on malformed buffer — caller should log and drop.
 *
 * Only SNAP_QUOTE (mode 3) is fully decoded. LTP / QUOTE buffers are decoded
 * partially but flagged so the adapter can decide to drop them.
 */
export function decodeBinaryTick(
  buffer: ArrayBuffer,
): { ok: true } & DecodeResult | { ok: false } & DecodeError {

  if (buffer.byteLength < MIN_SNAP_LEN) {
    return {
      ok:     false,
      reason: `Buffer too short: ${buffer.byteLength} < ${MIN_SNAP_LEN}`,
      bufLen: buffer.byteLength,
    };
  }

  const view = new DataView(buffer);
  const mode         = view.getUint8(OFF_MODE);
  const exchangeType = view.getUint8(OFF_EXCHANGE_TYPE);
  const token        = readToken(view, OFF_TOKEN, 25);

  if (!token) {
    return { ok: false, reason: 'Empty token in binary frame', bufLen: buffer.byteLength };
  }

  const exchangeTimestamp = readInt64LE(view, OFF_EXCHANGE_TS);
  const lastTradedPrice   = readInt64LE(view, OFF_LTP);
  const avgTradedPrice    = readInt64LE(view, OFF_AVG_PRICE);
  const volume            = readInt64LE(view, OFF_VOLUME);
  const totalBuyQty       = readInt64LE(view, OFF_TOTAL_BUY_QTY);
  const totalSellQty      = readInt64LE(view, OFF_TOTAL_SELL_QTY);
  const openPrice         = readInt64LE(view, OFF_OPEN);
  const highPrice         = readInt64LE(view, OFF_HIGH);
  const lowPrice          = readInt64LE(view, OFF_LOW);
  const bidPrice          = readInt64LE(view, OFF_BEST_BID_PRICE);
  const askPrice          = readInt64LE(view, OFF_BEST_ASK_PRICE);

  const raw: RawTick = {
    token,
    exchangeType,
    lastTradedPrice,
    volume,
    exchangeTimestamp,
    ...(avgTradedPrice  > 0 && { avgTradedPrice  }),
    ...(openPrice       > 0 && { openPrice       }),
    ...(highPrice       > 0 && { highPrice       }),
    ...(lowPrice        > 0 && { lowPrice        }),
    ...(bidPrice        > 0 && { bidPrice        }),
    ...(askPrice        > 0 && { askPrice        }),
    ...(totalBuyQty     > 0 && { totalBuyQty     }),
    ...(totalSellQty    > 0 && { totalSellQty    }),
  };

  return { ok: true, raw, mode };
}
