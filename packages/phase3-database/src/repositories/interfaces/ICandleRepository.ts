/**
 * ICandleRepository.ts — Artha AI Phase 3
 * OHLCV candle access contract.
 */
import type { CandleRow, TimeframeEnum } from '../../types/domain';
import type { InsertCandle } from '../../types/insert-dtos';

export interface ICandleRepository {
  /**
   * Upsert a candle. Conflict target: (symbol_id, timeframe, bucket_ts).
   * Used by CandleAggregator for both partial updates and final close.
   */
  upsert(candle: InsertCandle): Promise<void>;

  /**
   * Batch upsert — used by historical REST backfill.
   */
  upsertMany(candles: InsertCandle[]): Promise<void>;

  /**
   * Time-range scan — primary backtest data access.
   * MUST include timeframe in query to use idx_candles_backtest covering index.
   */
  findRange(
    symbolId:  string,
    timeframe: TimeframeEnum,
    from:      Date,
    to:        Date,
  ): Promise<CandleRow[]>;

  /** Latest N candles for a symbol+timeframe. Used by signal engine. */
  findLatest(symbolId: string, timeframe: TimeframeEnum, limit: number): Promise<CandleRow[]>;

  /** Find the most recent closed candle for a symbol+timeframe. */
  findLastClosed(symbolId: string, timeframe: TimeframeEnum): Promise<CandleRow | null>;
}
