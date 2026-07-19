/**
 * packages/phase3-database/src/repositories/pg/PgExecutionRepository.ts
 * Artha AI — Phase 3
 *
 * Append-only fill record. INSERT only — no UPDATE/DELETE operations.
 */

import type { Pool } from 'pg';
import type { IExecutionRepository } from '../interfaces/IExecutionRepository';
import type { ExecutionRow } from '../../types/domain';
import type { InsertExecution } from '../../types/insert-dtos';

function mapRow(r: Record<string, unknown>): ExecutionRow {
  return {
    execution_id:   r['execution_id'] as string,
    order_id:       r['order_id'] as string,
    trade_id:       r['trade_id'] as string,
    broker_fill_id: (r['broker_fill_id'] as string | null) ?? null,
    fill_qty:       parseFloat(r['fill_qty'] as string),
    fill_price:     parseFloat(r['fill_price'] as string),
    commission:     parseFloat(r['commission'] as string),
    exchange_seg:   (r['exchange_seg'] as string | null) ?? null,
    exchange_ts:    r['exchange_ts'] != null ? new Date(r['exchange_ts'] as string) : null,
    received_ts:    new Date(r['received_ts'] as string),
  };
}

export class PgExecutionRepository implements IExecutionRepository {
  constructor(private readonly pool: Pool) {}

  async insert(execution: InsertExecution): Promise<ExecutionRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO executions (
         order_id, trade_id, broker_fill_id,
         fill_qty, fill_price, commission, exchange_seg, exchange_ts
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        execution.order_id, execution.trade_id, execution.broker_fill_id ?? null,
        execution.fill_qty, execution.fill_price, execution.commission ?? 0,
        execution.exchange_seg ?? null, execution.exchange_ts ?? null,
      ],
    );
    return mapRow(rows[0]);
  }

  async findByTrade(tradeId: string): Promise<ExecutionRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM executions WHERE trade_id = $1 ORDER BY exchange_ts ASC`,
      [tradeId],
    );
    return rows.map(mapRow);
  }

  async findByOrder(orderId: string): Promise<ExecutionRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM executions WHERE order_id = $1 ORDER BY exchange_ts ASC`,
      [orderId],
    );
    return rows.map(mapRow);
  }

  async existsByBrokerFillId(brokerFillId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM executions WHERE broker_fill_id = $1 LIMIT 1`,
      [brokerFillId],
    );
    return rows.length > 0;
  }
}
