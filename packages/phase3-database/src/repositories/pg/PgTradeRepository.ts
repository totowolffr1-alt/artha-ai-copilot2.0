/**
 * packages/phase3-database/src/repositories/pg/PgTradeRepository.ts
 * Artha AI — Phase 3
 *
 * Logical trade lifecycle — insert, find, update.
 * updated_at is always refreshed on every update call.
 */

import type { Pool } from 'pg';
import type { ITradeRepository, TradeUpdateFields } from '../interfaces/ITradeRepository';
import type { TradeRow } from '../../types/domain';
import type { InsertTrade } from '../../types/insert-dtos';

function mapRow(r: Record<string, unknown>): TradeRow {
  return {
    trade_id:        r['trade_id'] as string,
    signal_id:       (r['signal_id'] as string | null) ?? null,
    symbol_id:       r['symbol_id'] as string,
    account_id:      r['account_id'] as string,
    mode:            r['mode'] as TradeRow['mode'],
    direction:       r['direction'] as TradeRow['direction'],
    qty:             parseFloat(r['qty'] as string),
    filled_qty:      parseFloat(r['filled_qty'] as string),
    avg_entry_price: r['avg_entry_price'] != null ? parseFloat(r['avg_entry_price'] as string) : null,
    avg_exit_price:  r['avg_exit_price'] != null ? parseFloat(r['avg_exit_price'] as string) : null,
    realised_pnl:    r['realised_pnl'] != null ? parseFloat(r['realised_pnl'] as string) : null,
    commission:      parseFloat(r['commission'] as string),
    slippage:        r['slippage'] != null ? parseFloat(r['slippage'] as string) : null,
    close_reason:    (r['close_reason'] as TradeRow['close_reason']) ?? null,
    status:          r['status'] as TradeRow['status'],
    opened_at:       r['opened_at'] != null ? new Date(r['opened_at'] as string) : null,
    closed_at:       r['closed_at'] != null ? new Date(r['closed_at'] as string) : null,
    updated_at:      new Date(r['updated_at'] as string),
  };
}

export class PgTradeRepository implements ITradeRepository {
  constructor(private readonly pool: Pool) {}

  async insert(trade: InsertTrade): Promise<TradeRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO trades (
         signal_id, symbol_id, account_id, mode, direction, qty, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        trade.signal_id ?? null,
        trade.symbol_id,
        trade.account_id,
        trade.mode,
        trade.direction,
        trade.qty,
        trade.status ?? 'pending',
      ],
    );
    return mapRow(rows[0]);
  }

  async findById(tradeId: string): Promise<TradeRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM trades WHERE trade_id = $1`,
      [tradeId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findOpen(accountId: string): Promise<TradeRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM trades
       WHERE account_id = $1
         AND status IN ('open', 'partial')
       ORDER BY opened_at DESC`,
      [accountId],
    );
    return rows.map(mapRow);
  }

  async findBySignal(signalId: string): Promise<TradeRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM trades WHERE signal_id = $1`,
      [signalId],
    );
    return rows.map(mapRow);
  }

  async update(tradeId: string, fields: TradeUpdateFields): Promise<void> {
    // Build dynamic SET clause — only update fields that are provided
    const setClauses: string[] = ['updated_at = now()'];
    const values: unknown[] = [];
    let paramIdx = 1;

    const addField = (col: string, val: unknown): void => {
      setClauses.push(`${col} = $${paramIdx}`);
      values.push(val);
      paramIdx++;
    };

    if (fields.status          !== undefined) addField('status',          fields.status);
    if (fields.filled_qty      !== undefined) addField('filled_qty',      fields.filled_qty);
    if (fields.avg_entry_price !== undefined) addField('avg_entry_price', fields.avg_entry_price);
    if (fields.avg_exit_price  !== undefined) addField('avg_exit_price',  fields.avg_exit_price);
    if (fields.realised_pnl    !== undefined) addField('realised_pnl',    fields.realised_pnl);
    if (fields.commission      !== undefined) addField('commission',      fields.commission);
    if (fields.slippage        !== undefined) addField('slippage',        fields.slippage);
    if (fields.close_reason    !== undefined) addField('close_reason',    fields.close_reason);
    if (fields.opened_at       !== undefined) addField('opened_at',       fields.opened_at);
    if (fields.closed_at       !== undefined) addField('closed_at',       fields.closed_at);

    values.push(tradeId);
    await this.pool.query(
      `UPDATE trades SET ${setClauses.join(', ')} WHERE trade_id = $${paramIdx}`,
      values,
    );
  }

  async findByAccountAndMode(
    accountId: string,
    mode:      string,
    from?:     Date,
    to?:       Date,
  ): Promise<TradeRow[]> {
    const params: unknown[] = [accountId, mode];
    let sql = `SELECT * FROM trades WHERE account_id = $1 AND mode = $2`;
    if (from) { params.push(from); sql += ` AND opened_at >= $${params.length}`; }
    if (to)   { params.push(to);   sql += ` AND opened_at <  $${params.length}`; }
    sql += ` ORDER BY opened_at DESC`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(mapRow);
  }
}
