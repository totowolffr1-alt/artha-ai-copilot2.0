/**
 * packages/phase7-broker/src/contracts/IBrokerAdapter.ts
 * Artha AI — Phase 7 Broker Abstraction
 */

import { OrderRequest, BrokerResponse, FillEvent } from '../types/domain';

export interface OrderReference {
  readonly idempotency_key: string;
  readonly broker_order_id?: string;
}

export interface IBrokerAdapter {
  readonly adapter_mode: 'PAPER' | 'LIVE';

  placeOrder(request: OrderRequest): Promise<BrokerResponse>;

  cancelOrder(ref: OrderReference): Promise<BrokerResponse>;

  getOrderStatus(ref: OrderReference): Promise<BrokerResponse>;

  streamFills(
    onFill: (fill: FillEvent) => void,
    onError: (err: BrokerStreamError) => void
  ): BrokerSubscription;
}

export interface BrokerSubscription {
  readonly subscription_id: string;
  unsubscribe(): void;
}

export interface BrokerStreamError {
  readonly cause: 'CONNECTION_LOST' | 'AUTH_EXPIRED' | 'UNKNOWN';
  readonly occurred_at: Date;
  readonly recoverable: boolean;
}

export interface BrokerLatencyConfig {
  readonly place_order_timeout_ms: number;
  readonly cancel_order_timeout_ms: number;
  readonly get_status_timeout_ms: number;
  readonly status_max_staleness_ms: number;
  readonly stream_reconnect_backoff_ms: number;
  readonly stream_max_reconnect_attempts: number;
}

export const DEFAULT_LATENCY_CONFIG: BrokerLatencyConfig = {
  place_order_timeout_ms: 3000,
  cancel_order_timeout_ms: 2000,
  get_status_timeout_ms: 1500,
  status_max_staleness_ms: 500,
  stream_reconnect_backoff_ms: 1000,
  stream_max_reconnect_attempts: 5,
};
