/**
 * packages/phase3-database/src/repositories/pg/PgOrderRepository.ts
 * Artha AI — Phase 3
 */

import type { Pool } from 'pg';
import type { IOrderRepository, OrderUpdateFields } from '../interfaces/IOrderRepository';
import type { OrderRow } from '../../types/domain';
import type { InsertOrder } from '../../types/insert-dtos';

function mapRow(r: Record<string, unknown>): OrderRow {
  return {
    order_id:        r['order_id'] as string,
    trade_id:        r['trade_id'] as string,
    symbol_id:       r['symbol_id'] as string,
    broker_order_id: (r['broker_order_id'] as string | null) ?? null,
    order_type:      r['order_type'] as OrderRow['order_type'],
    direction:       r['direction'] as OrderRow['direction'],
    qty:             parseFloat(r['qty'] as string),
    price:           r['price'] != null ? parseFloat(r['price'] as string) : null,
    trigger_price:   r['trigger_price'] != null ? parseFloat(r['trigger_price'] as string) : null,
    product_type:    r['product_type'] as string,
    validity:        r['validity'] as OrderRow['validity'],
    status:          r['status'] as OrderRow['status'],
    reject_reason:   (r['reject_reason'] as string | null) ?? null,
    placed_at:       r['placed_at'] != null ? new Date(r['placed_at'] as string) : null,
    updated_at:      new Date(r['updated_at'] as string),
  };
}

export class PgOrderRepository implements IOrderRepository {
  constructor(private readonly pool: Pool) {}

  async insert(order: InsertOrder): Promise<OrderRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO orders (
         trade_id, symbol_id, order_type, direction, qty,
         price, trigger_price, product_type, validity, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        order.trade_id, order.symbol_id, order.order_type, order.direction,
        order.qty, order.price ?? null, order.trigger_price ?? null,
        order.product_type, order.validity ?? 'DAY', order.status ?? 'pending',
      ],
    );
    return mapRow(rows[0]);
  }

  async findById(orderId: string): Promise<OrderRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM orders WHERE order_id = $1`,
      [orderId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findByBrokerOrderId(brokerOrderId: string): Promise<OrderRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM orders WHERE broker_order_id = $1`,
      [brokerOrderId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findOpenByTrade(tradeId: string): Promise<OrderRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM orders
       WHERE trade_id = $1 AND status IN ('pending', 'placed', 'open', 'partial')
       ORDER BY placed_at ASC`,
      [tradeId],
    );
    return rows.map(mapRow);
  }

  async update(orderId: string, fields: OrderUpdateFields): Promise<void> {
    const setClauses: string[] = ['updated_at = now()'];
    const values: unknown[] = [];
    let idx = 1;
    const add = (col: string, val: unknown): void => {
      setClauses.push(`${col} = $${idx}`); values.push(val); idx++;
    };
    if (fields.broker_order_id !== undefined) add('broker_order_id', fields.broker_order_id);
    if (fields.status          !== undefined) add('status',          fields.status);
    if (fields.reject_reason   !== undefined) add('reject_reason',   fields.reject_reason);
    if (fields.placed_at       !== undefined) add('placed_at',       fields.placed_at);
    values.push(orderId);
    await this.pool.query(
      `UPDATE orders SET ${setClauses.join(', ')} WHERE order_id = $${idx}`,
      values,
    );
  }
}
