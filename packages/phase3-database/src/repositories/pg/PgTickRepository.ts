/**
 * packages/phase3-database/src/repositories/pg/PgTickRepository.ts
 * Artha AI — Phase 3
 *
 * High-throughput tick batch insert.
 * Uses pg COPY protocol simulation via multi-row unnest VALUES for maximum throughput.
 * Connection used for inserts MUST be from the tick-writer pool (synchronous_commit=off).
 */

import type { Pool } from 'pg';
import type { ITickRepository } from '../interfaces/ITickRepository';
import type { TickRow } from '../../types/domain';
import type { InsertTick } from '../../types/insert-dtos';

function mapRow(r: Record<string, unknown>): TickRow {
  return {
    tick_id:          r['tick_id'] as string,
    symbol_id:        r['symbol_id'] as string,
    exchange_ts:      new Date(r['exchange_ts'] as string),
    received_ts:      new Date(r['received_ts'] as string),
    price:            parseFloat(r['price'] as string),
    volume:           parseInt(r['volume'] as string, 10),
    bid:              r['bid'] != null ? parseFloat(r['bid'] as string) : null,
    ask:              r['ask'] != null ? parseFloat(r['ask'] as string) : null,
    open_price:       r['open_price'] != null ? parseFloat(r['open_price'] as string) : null,
    high_price:       r['high_price'] != null ? parseFloat(r['high_price'] as string) : null,
    low_price:        r['low_price'] != null ? parseFloat(r['low_price'] as string) : null,
    avg_traded_price: r['avg_traded_price'] != null ? parseFloat(r['avg_traded_price'] as string) : null,
    total_buy_qty:    r['total_buy_qty'] != null ? parseInt(r['total_buy_qty'] as string, 10) : null,
    total_sell_qty:   r['total_sell_qty'] != null ? parseInt(r['total_sell_qty'] as string, 10) : null,
    session_id:       r['session_id'] as string,
  };
}

export class PgTickRepository implements ITickRepository {
  constructor(
    private readonly pool: Pool,
    /** Separate pool for tick writes — synchronous_commit=off */
    private readonly tickWriterPool?: Pool,
  ) {}

  private get writePool(): Pool {
    return this.tickWriterPool ?? this.pool;
  }

  async insertBatch(ticks: InsertTick[]): Promise<void> {
    if (ticks.length === 0) return;

    // Build a multi-row unnest insert for bulk throughput.
    // This avoids per-row round trips while keeping parameterized queries.
    const now = new Date();
    const symbolIds:       string[]  = [];
    const exchangeTs:      Date[]    = [];
    const receivedTs:      Date[]    = [];
    const prices:          number[]  = [];
    const volumes:         number[]  = [];
    const bids:            (number | null)[] = [];
    const asks:            (number | null)[] = [];
    const openPrices:      (number | null)[] = [];
    const highPrices:      (number | null)[] = [];
    const lowPrices:       (number | null)[] = [];
    const avgTradedPrices: (number | null)[] = [];
    const totalBuyQtys:    (number | null)[] = [];
    const totalSellQtys:   (number | null)[] = [];
    const sessionIds:      string[]  = [];

    for (const t of ticks) {
      symbolIds.push(t.symbol_id);
      exchangeTs.push(t.exchange_ts);
      receivedTs.push(t.received_ts ?? now);
      prices.push(t.price);
      volumes.push(t.volume);
      bids.push(t.bid ?? null);
      asks.push(t.ask ?? null);
      openPrices.push(t.open_price ?? null);
      highPrices.push(t.high_price ?? null);
      lowPrices.push(t.low_price ?? null);
      avgTradedPrices.push(t.avg_traded_price ?? null);
      totalBuyQtys.push(t.total_buy_qty ?? null);
      totalSellQtys.push(t.total_sell_qty ?? null);
      sessionIds.push(t.session_id);
    }

    await this.writePool.query(
      `INSERT INTO ticks (
         symbol_id, exchange_ts, received_ts, price, volume,
         bid, ask, open_price, high_price, low_price,
         avg_traded_price, total_buy_qty, total_sell_qty, session_id
       )
       SELECT
         unnest($1::uuid[]),
         unnest($2::timestamptz[]),
         unnest($3::timestamptz[]),
         unnest($4::numeric[]),
         unnest($5::bigint[]),
         unnest($6::numeric[]),
         unnest($7::numeric[]),
         unnest($8::numeric[]),
         unnest($9::numeric[]),
         unnest($10::numeric[]),
         unnest($11::numeric[]),
         unnest($12::bigint[]),
         unnest($13::bigint[]),
         unnest($14::varchar[])
       ON CONFLICT DO NOTHING`,
      [
        symbolIds, exchangeTs, receivedTs, prices, volumes,
        bids, asks, openPrices, highPrices, lowPrices,
        avgTradedPrices, totalBuyQtys, totalSellQtys, sessionIds,
      ],
    );
  }

  async findRange(symbolId: string, from: Date, to: Date): Promise<TickRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM ticks
       WHERE symbol_id = $1
         AND exchange_ts >= $2
         AND exchange_ts <  $3
       ORDER BY exchange_ts ASC`,
      [symbolId, from, to],
    );
    return rows.map(mapRow);
  }

  async findLatest(symbolId: string, limit: number): Promise<TickRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM ticks
       WHERE symbol_id = $1
       ORDER BY exchange_ts DESC
       LIMIT $2`,
      [symbolId, limit],
    );
    return rows.map(mapRow).reverse();
  }
}
