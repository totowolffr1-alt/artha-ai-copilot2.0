/**
 * packages/phase3-database/src/repositories/pg/PgPositionRepository.ts
 * Artha AI — Phase 3
 */

import type { Pool } from 'pg';
import type { IPositionRepository, PositionUpdateFields } from '../interfaces/IPositionRepository';
import type { PositionRow } from '../../types/domain';
import type { InsertPosition } from '../../types/insert-dtos';

function mapRow(r: Record<string, unknown>): PositionRow {
  return {
    position_id:    r['position_id'] as string,
    portfolio_id:   r['portfolio_id'] as string,
    symbol_id:      r['symbol_id'] as string,
    trade_id:       r['trade_id'] as string,
    direction:      r['direction'] as PositionRow['direction'],
    qty:            parseFloat(r['qty'] as string),
    avg_cost:       parseFloat(r['avg_cost'] as string),
    ltp:            r['ltp'] != null ? parseFloat(r['ltp'] as string) : null,
    unrealised_pnl: parseFloat(r['unrealised_pnl'] as string),
    realised_pnl:   parseFloat(r['realised_pnl'] as string),
    mtm_value:      parseFloat(r['mtm_value'] as string),
    margin_blocked: parseFloat(r['margin_blocked'] as string),
    status:         r['status'] as PositionRow['status'],
    opened_at:      new Date(r['opened_at'] as string),
    closed_at:      r['closed_at'] != null ? new Date(r['closed_at'] as string) : null,
    updated_at:     new Date(r['updated_at'] as string),
  };
}

export class PgPositionRepository implements IPositionRepository {
  constructor(private readonly pool: Pool) {}

  async insert(position: InsertPosition): Promise<PositionRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO positions (
         portfolio_id, symbol_id, trade_id, direction, qty,
         avg_cost, opened_at, margin_blocked
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        position.portfolio_id,
        position.symbol_id,
        position.trade_id,
        position.direction,
        position.qty,
        position.avg_cost,
        position.opened_at,
        position.margin_blocked ?? 0,
      ],
    );
    return mapRow(rows[0]);
  }

  async findById(positionId: string): Promise<PositionRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM positions WHERE position_id = $1`,
      [positionId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findByTrade(tradeId: string): Promise<PositionRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM positions WHERE trade_id = $1`,
      [tradeId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findActive(portfolioId: string): Promise<PositionRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM positions
       WHERE portfolio_id = $1 AND status IN ('open', 'partial')
       ORDER BY opened_at DESC`,
      [portfolioId],
    );
    return rows.map(mapRow);
  }

  async findActiveBySymbol(symbolId: string, portfolioId: string): Promise<PositionRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM positions
       WHERE symbol_id = $1 AND portfolio_id = $2 AND status IN ('open', 'partial')
       ORDER BY opened_at DESC`,
      [symbolId, portfolioId],
    );
    return rows.map(mapRow);
  }

  async update(positionId: string, fields: PositionUpdateFields): Promise<void> {
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [];
    let idx = 1;
    const add = (col: string, val: unknown): void => {
      sets.push(`${col} = $${idx}`);
      values.push(val);
      idx++;
    };

    if (fields.qty            !== undefined) add('qty', fields.qty);
    if (fields.ltp            !== undefined) add('ltp', fields.ltp);
    if (fields.unrealised_pnl !== undefined) add('unrealised_pnl', fields.unrealised_pnl);
    if (fields.realised_pnl   !== undefined) add('realised_pnl', fields.realised_pnl);
    if (fields.mtm_value      !== undefined) add('mtm_value', fields.mtm_value);
    if (fields.margin_blocked !== undefined) add('margin_blocked', fields.margin_blocked);
    if (fields.status         !== undefined) add('status', fields.status);
    if (fields.closed_at      !== undefined) add('closed_at', fields.closed_at);

    if (sets.length === 1) return; // Only updated_at

    values.push(positionId);
    await this.pool.query(
      `UPDATE positions SET ${sets.join(', ')} WHERE position_id = $${idx}`,
      values,
    );
  }
}
