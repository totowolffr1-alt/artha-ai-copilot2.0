/**
 * packages/phase3-database/src/repositories/pg/PgCandleRepository.ts
 * Artha AI — Phase 3
 */

import type { Pool } from 'pg';
import type { ICandleRepository } from '../interfaces/ICandleRepository';
import type { CandleRow, TimeframeEnum } from '../../types/domain';
import type { InsertCandle } from '../../types/insert-dtos';

function mapRow(r: Record<string, unknown>): CandleRow {
  return {
    candle_id:    r['candle_id'] as string,
    symbol_id:    r['symbol_id'] as string,
    bucket_ts:    new Date(r['bucket_ts'] as string),
    timeframe:    r['timeframe'] as TimeframeEnum,
    open:         parseFloat(r['open'] as string),
    high:         parseFloat(r['high'] as string),
    low:          parseFloat(r['low'] as string),
    close:        parseFloat(r['close'] as string),
    volume:       parseInt(r['volume'] as string, 10),
    vwap:         r['vwap'] != null ? parseFloat(r['vwap'] as string) : null,
    delta_volume: r['delta_volume'] != null ? parseInt(r['delta_volume'] as string, 10) : null,
    tick_count:   parseInt(r['tick_count'] as string, 10),
    state:        r['state'] as CandleRow['state'],
    is_partial:   r['is_partial'] as boolean,
  };
}

export class PgCandleRepository implements ICandleRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(candle: InsertCandle): Promise<void> {
    await this.pool.query(
      `INSERT INTO candles (
         symbol_id, bucket_ts, timeframe, open, high, low, close,
         volume, vwap, delta_volume, tick_count, state, is_partial
       ) VALUES ($1, $2, $3::timeframe_t, $4, $5, $6, $7, $8, $9, $10, $11, $12::candle_st, $13)
       ON CONFLICT (symbol_id, timeframe, bucket_ts)
       DO UPDATE SET
         high         = GREATEST(candles.high, EXCLUDED.high),
         low          = LEAST(candles.low, EXCLUDED.low),
         close        = EXCLUDED.close,
         volume       = EXCLUDED.volume,
         vwap         = EXCLUDED.vwap,
         delta_volume = EXCLUDED.delta_volume,
         tick_count   = EXCLUDED.tick_count,
         state        = EXCLUDED.state,
         is_partial   = EXCLUDED.is_partial`,
      [
        candle.symbol_id, candle.bucket_ts, candle.timeframe,
        candle.open, candle.high, candle.low, candle.close,
        candle.volume, candle.vwap ?? null, candle.delta_volume ?? null,
        candle.tick_count ?? 0, candle.state ?? 'partial', candle.is_partial ?? true,
      ],
    );
  }

  async upsertMany(candles: InsertCandle[]): Promise<void> {
    for (const candle of candles) {
      await this.upsert(candle);
    }
  }

  async findRange(
    symbolId:  string,
    timeframe: TimeframeEnum,
    from:      Date,
    to:        Date,
  ): Promise<CandleRow[]> {
    const { rows } = await this.pool.query(
      `SELECT symbol_id, timeframe, bucket_ts, open, high, low, close, volume,
              vwap, delta_volume, tick_count, state, is_partial, candle_id
       FROM candles
       WHERE symbol_id = $1
         AND timeframe = $2::timeframe_t
         AND bucket_ts >= $3
         AND bucket_ts <  $4
       ORDER BY bucket_ts ASC`,
      [symbolId, timeframe, from, to],
    );
    return rows.map(mapRow);
  }

  async findLatest(symbolId: string, timeframe: TimeframeEnum, limit: number): Promise<CandleRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM candles
       WHERE symbol_id = $1 AND timeframe = $2::timeframe_t
       ORDER BY bucket_ts DESC
       LIMIT $3`,
      [symbolId, timeframe, limit],
    );
    return rows.map(mapRow).reverse();
  }

  async findLastClosed(symbolId: string, timeframe: TimeframeEnum): Promise<CandleRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM candles
       WHERE symbol_id = $1 AND timeframe = $2::timeframe_t AND state = 'closed'
       ORDER BY bucket_ts DESC
       LIMIT 1`,
      [symbolId, timeframe],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }
}
