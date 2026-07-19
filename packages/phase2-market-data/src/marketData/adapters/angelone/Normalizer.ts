/**
 * src/marketData/adapters/angelone/Normalizer.ts
 * Phase 2C — INormalizer implementation for AngelOne SmartAPI.
 *
 * Implements every conversion rule defined in normalizer.ts (Phase 2B).
 * This is the ONLY place in the codebase that knows:
 *   - SmartAPI prices come in paise from WebSocket (÷100 for rupees)
 *   - SmartAPI REST historical prices are already in rupees (no ÷100)
 *   - SmartAPI timestamps are IST ISO8601 strings
 *   - SmartAPI exchange type codes (1→NSE, 2→NFO, etc.)
 *   - SmartAPI instrument type strings ("EQ"→equity, "OPTIDX"→options, etc.)
 *
 * Every public method is pure and never throws.
 * Invalid input returns err(ValidationError | NormalizationError).
 */

import type { Candle, Tick, Symbol, Timeframe, Exchange, AssetType } from '../../types';
import type { RawTick, RawCandle, RawSymbol }                        from '../IMarketDataAdapter';
import type { INormalizer }                                           from '../../normalizer';
import type { Result }                                                from '../../../utils/errors';
import { ok, err }                                                    from '../../../utils/errors';
import {
  SMARTAPI_EXCHANGE_TYPE_MAP,
  SMARTAPI_INSTRUMENT_TYPE_MAP,
}                                                                     from '../../normalizer';

// ─── Normalizer ───────────────────────────────────────────────────────────────

export class Normalizer implements INormalizer {

  // ─── normalizeTick ──────────────────────────────────────────────────────────

  normalizeTick(raw: RawTick, symbol: string): Result<Tick> {
    // Paise validation
    const priceResult = this.paiseToRupees(raw.lastTradedPrice);
    if (!priceResult.ok) return priceResult;

    // Exchange
    const exchResult = this.normalizeExchange(raw.exchangeType);
    if (!exchResult.ok) return exchResult;

    // Timestamp
    const tsResult = this.validateTimestamp(raw.exchangeTimestamp, 'tick');
    if (!tsResult.ok) return tsResult;

    // Volume
    if (!isFinite(raw.volume) || raw.volume < 0) {
      return err({
        type:    'ValidationError',
        field:   'volume',
        rule:    'isFinite(v) && v >= 0',
        actual:  raw.volume,
        message: `Invalid tick volume: ${raw.volume}`,
      });
    }

    const price = priceResult.value;

    // Optional fields — convert from paise, silently drop if invalid
    const bid = raw.bidPrice != null ? this.paiseToRupeesUnchecked(raw.bidPrice) : undefined;
    const ask = raw.askPrice != null ? this.paiseToRupeesUnchecked(raw.askPrice) : undefined;

    // bid < ask guard (only when both present)
    if (bid != null && ask != null && bid >= ask) {
      // Malformed bid/ask — drop both rather than propagate corrupt spread
      return this.buildTick(symbol, exchResult.value, raw, price, undefined, undefined);
    }

    return this.buildTick(symbol, exchResult.value, raw, price, bid, ask);
  }

  // ─── normalizeCandle ────────────────────────────────────────────────────────

  normalizeCandle(raw: RawCandle, symbol: string, timeframe: Timeframe): Result<Candle> {
    // Timestamp (IST string → unix ms UTC)
    const tsResult = this.istStringToUnixMs(raw.timestamp);
    if (!tsResult.ok) return tsResult;

    // OHLCV validation (REST prices already in rupees)
    const fields: Array<[string, number]> = [
      ['open',   raw.open],
      ['high',   raw.high],
      ['low',    raw.low],
      ['close',  raw.close],
    ];

    for (const [field, value] of fields) {
      if (!isFinite(value) || value <= 0) {
        return err({
          type:    'ValidationError',
          field,
          rule:    'isFinite(v) && v > 0',
          actual:  value,
          message: `Invalid candle ${field}: ${value} for ${symbol}`,
        });
      }
    }

    if (!isFinite(raw.volume) || raw.volume < 0) {
      return err({
        type:    'ValidationError',
        field:   'volume',
        rule:    'isFinite(v) && v >= 0',
        actual:  raw.volume,
        message: `Invalid candle volume: ${raw.volume} for ${symbol}`,
      });
    }

    // OHLCV structural invariants
    if (raw.high < raw.low) {
      return err({
        type:    'ValidationError',
        field:   'high',
        rule:    'high >= low',
        actual:  `high=${raw.high}, low=${raw.low}`,
        message: `Candle high (${raw.high}) < low (${raw.low}) for ${symbol}`,
      });
    }
    if (raw.high < raw.open || raw.high < raw.close) {
      return err({
        type:    'ValidationError',
        field:   'high',
        rule:    'high >= open && high >= close',
        actual:  `high=${raw.high}, open=${raw.open}, close=${raw.close}`,
        message: `Candle high (${raw.high}) below open or close for ${symbol}`,
      });
    }
    if (raw.low > raw.open || raw.low > raw.close) {
      return err({
        type:    'ValidationError',
        field:   'low',
        rule:    'low <= open && low <= close',
        actual:  `low=${raw.low}, open=${raw.open}, close=${raw.close}`,
        message: `Candle low (${raw.low}) above open or close for ${symbol}`,
      });
    }

    // Exchange not available in RawCandle — caller provides via symbol context.
    // We hard-code NSE as placeholder; Phase 3 caller passes correct exchange.
    // TODO(Phase3): Thread exchange through FetchCandlesOptions → normalizeCandle.
    const candle: Candle = {
      symbol,
      exchange:  'NSE',   // overridden by caller in Phase 3 when exchange is known
      timeframe,
      timestamp: tsResult.value,
      open:      raw.open,
      high:      raw.high,
      low:       raw.low,
      close:     raw.close,
      volume:    raw.volume,
      state:     'closed',
    };

    return ok(candle);
  }

  // ─── normalizeSymbol ────────────────────────────────────────────────────────

  normalizeSymbol(raw: RawSymbol): Result<Symbol> {
    const exchResult  = this.normalizeExchangeString(raw.exchange);
    if (!exchResult.ok) return exchResult;

    const assetResult = this.normalizeAssetType(raw.instrumentType);
    if (!assetResult.ok) return assetResult;

    const lotSize  = Number(raw.lotSize);
    const tickSize = Number(raw.tickSize);

    if (!isFinite(lotSize) || lotSize <= 0) {
      return err({
        type:     'NormalizationError',
        rawField: 'lotSize',
        rawValue: raw.lotSize,
        message:  `Invalid lotSize: ${raw.lotSize}`,
      });
    }

    const symbol: Symbol = {
      ticker:    raw.symbol.replace(/-EQ$/, ''),   // strip SmartAPI's "-EQ" suffix
      name:      raw.name,
      exchange:  exchResult.value,
      assetType: assetResult.value,
      lotSize,
      tickSize:  isFinite(tickSize) ? tickSize : 0.05,
      ...(raw.isin   && { isin:   raw.isin   }),
      ...(raw.sector && { sector: raw.sector }),
      isActive:  true,   // inactive instruments should not appear in search results
    };

    return ok(symbol);
  }

  // ─── normalizeExchange (by numeric type code) ────────────────────────────────

  normalizeExchange(exchangeType: number): Result<Exchange> {
    const exchange = SMARTAPI_EXCHANGE_TYPE_MAP[exchangeType];
    if (!exchange) {
      return err({
        type:     'NormalizationError',
        rawField: 'exchangeType',
        rawValue: exchangeType,
        message:  `Unknown SmartAPI exchange type code: ${exchangeType}`,
      });
    }
    return ok(exchange);
  }

  // ─── normalizeAssetType ──────────────────────────────────────────────────────

  normalizeAssetType(instrumentType: string): Result<AssetType> {
    const assetType = SMARTAPI_INSTRUMENT_TYPE_MAP[instrumentType];
    if (!assetType) {
      return err({
        type:     'NormalizationError',
        rawField: 'instrumentType',
        rawValue: instrumentType,
        message:  `Unknown SmartAPI instrument type: ${instrumentType}`,
      });
    }
    return ok(assetType);
  }

  // ─── paiseToRupees ───────────────────────────────────────────────────────────

  paiseToRupees(paise: number): Result<number> {
    if (!Number.isInteger(paise) || paise <= 0) {
      return err({
        type:    'ValidationError',
        field:   'paise',
        rule:    'Number.isInteger(paise) && paise > 0',
        actual:  paise,
        message: `Invalid paise value: ${paise}. Must be a positive integer.`,
      });
    }
    return ok(paise / 100);
  }

  // ─── istStringToUnixMs ───────────────────────────────────────────────────────

  istStringToUnixMs(istString: string): Result<number> {
    // SmartAPI returns "2024-01-15T09:15:00+05:30" — Date.parse honours the offset.
    // Also handles "2024-01-15 09:15" without offset — treat as IST by appending offset.
    let s = istString.trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) {
      s = s.replace(' ', 'T') + ':00+05:30';
    }

    const ms = Date.parse(s);
    if (!isFinite(ms) || ms <= 0) {
      return err({
        type:     'NormalizationError',
        rawField: 'timestamp',
        rawValue: istString,
        message:  `Cannot parse IST timestamp: "${istString}"`,
      });
    }

    return ok(ms);
  }

  // ─── unixMsToIstString ───────────────────────────────────────────────────────

  unixMsToIstString(tsMs: number): Result<string> {
    if (tsMs <= 0) {
      return err({
        type:    'ValidationError',
        field:   'tsMs',
        rule:    'tsMs > 0',
        actual:  tsMs,
        message: `Invalid unix ms timestamp: ${tsMs}`,
      });
    }

    // Format as "YYYY-MM-DD HH:mm" in IST
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istDate    = new Date(tsMs + IST_OFFSET);
    const pad        = (n: number) => String(n).padStart(2, '0');

    const yyyy = istDate.getUTCFullYear();
    const mm   = pad(istDate.getUTCMonth() + 1);
    const dd   = pad(istDate.getUTCDate());
    const hh   = pad(istDate.getUTCHours());
    const min  = pad(istDate.getUTCMinutes());

    return ok(`${yyyy}-${mm}-${dd} ${hh}:${min}`);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private normalizeExchangeString(exchange: string): Result<Exchange> {
    const validExchanges: Exchange[] = ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS'];
    if (validExchanges.includes(exchange as Exchange)) {
      return ok(exchange as Exchange);
    }
    return err({
      type:     'NormalizationError',
      rawField: 'exchange',
      rawValue: exchange,
      message:  `Unknown exchange string: ${exchange}`,
    });
  }

  private paiseToRupeesUnchecked(paise: number): number {
    return paise / 100;
  }

  private buildTick(
    symbol:   string,
    exchange: Exchange,
    raw:      RawTick,
    price:    number,
    bid:      number | undefined,
    ask:      number | undefined,
  ): Result<Tick> {
    const tick: Tick = {
      symbol,
      exchange,
      timestamp: raw.exchangeTimestamp,
      price,
      volume:    raw.volume,
      ...(bid != null           && { bid                                                      }),
      ...(ask != null           && { ask                                                      }),
      ...(raw.openPrice   != null && { openPrice:      this.paiseToRupeesUnchecked(raw.openPrice)      }),
      ...(raw.highPrice   != null && { highPrice:      this.paiseToRupeesUnchecked(raw.highPrice)      }),
      ...(raw.lowPrice    != null && { lowPrice:       this.paiseToRupeesUnchecked(raw.lowPrice)       }),
      ...(raw.avgTradedPrice != null && { avgTradedPrice: this.paiseToRupeesUnchecked(raw.avgTradedPrice) }),
    };
    return ok(tick);
  }

  private validateTimestamp(tsMs: number, context: string): Result<number> {
    if (!isFinite(tsMs) || tsMs <= 0) {
      return err({
        type:    'ValidationError',
        field:   'timestamp',
        rule:    'unixMs > 0',
        actual:  tsMs,
        message: `Invalid ${context} timestamp: ${tsMs}`,
      });
    }
    const now = Date.now();
    if (tsMs > now + 60_000) {  // allow 60s clock skew
      return err({
        type:    'ValidationError',
        field:   'timestamp',
        rule:    'unixMs <= Date.now()',
        actual:  tsMs,
        message: `${context} timestamp is in the future: ${tsMs} > ${now}`,
      });
    }
    return ok(tsMs);
  }
}
