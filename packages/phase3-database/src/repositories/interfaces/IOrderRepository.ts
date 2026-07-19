/**
 * IOrderRepository.ts — Artha AI Phase 3
 * Broker-facing order lifecycle contract.
 */
import type { OrderRow, OrderStatus } from '../../types/domain';
import type { InsertOrder } from '../../types/insert-dtos';

export interface OrderUpdateFields {
  broker_order_id?: string;
  status?:          OrderStatus;
  reject_reason?:   string;
  placed_at?:       Date;
}

export interface IOrderRepository {
  insert(order: InsertOrder): Promise<OrderRow>;

  findById(orderId: string): Promise<OrderRow | null>;

  /** Find by broker-assigned order ID — broker reconciliation hot path. */
  findByBrokerOrderId(brokerOrderId: string): Promise<OrderRow | null>;

  /** All open/partial/placed/pending orders for a trade. */
  findOpenByTrade(tradeId: string): Promise<OrderRow[]>;

  update(orderId: string, fields: OrderUpdateFields): Promise<void>;
}
