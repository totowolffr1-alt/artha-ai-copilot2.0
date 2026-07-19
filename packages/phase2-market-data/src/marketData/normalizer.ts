/**
 * src/marketData/normalizer.ts
 * Canonical normalizer contract — broker adapters implement this to translate
 * raw broker-shaped data into Artha's canonical Tick/Candle/Symbol types.
 */

import type { Result } from '../utils/errors';
import type { Tick, Candle, Symbol, Timeframe } from './types';
import type { RawTick, RawCandle, RawSymbol } from './adapters/IMarketDataAdapter';

export interface INormalizer {
  normalizeTick(raw: RawTick, symbol: string): Result<Tick>;
  normalizeCandle(raw: RawCandle, symbol: string, timeframe: Timeframe): Result<Candle>;
  normalizeSymbol(raw: RawSymbol): Result<Symbol>;
}
