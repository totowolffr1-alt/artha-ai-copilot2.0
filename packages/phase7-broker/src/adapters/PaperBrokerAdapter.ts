/**
 * packages/phase7-broker/src/adapters/PaperBrokerAdapter.ts
 * Artha AI — Phase 7 Paper Trading Adapter
 *
 * Fully local, deterministic simulation.
 * Supports configurable fault injection (latencies, specific statuses, partial fills)
 * to test state machine transitions and retry logic in isolation.
 */

import { IBrokerAdapter, OrderReference, BrokerSubscription, BrokerStreamError, BrokerLatencyConfig, DEFAULT_LATENCY_CONFIG } from '../contracts/IBrokerAdapter';
import { OrderRequest, BrokerResponse, FillEvent, OrderStatus } from '../types/domain';

export interface PaperBrokerFaultConfig {
  readonly force_status?: OrderStatus;
  readonly forced_reject_reason?: string;
  readonly simulated_latency_ms?: number;
  readonly partial_fill_ratio?: number; // e.g. 0.40 (fills 40% first, then remaining)
}

export class PaperBrokerAdapter implements IBrokerAdapter {
  readonly adapter_mode = 'PAPER';
  private readonly orders: Map<string, { request: OrderRequest; status: OrderStatus; filled_qty: number; broker_order_id: string }> = new Map();
  private onFillCallback?: (fill: FillEvent) => void;
  private onErrorCallback?: (err: BrokerStreamError) => void;

  constructor(
    private readonly latencyConfig: BrokerLatencyConfig = DEFAULT_LATENCY_CONFIG,
    private faultConfig: PaperBrokerFaultConfig = {}
  ) {}

  setFaultConfig(config: PaperBrokerFaultConfig): void {
    this.faultConfig = config;
  }

  async placeOrder(request: OrderRequest): Promise<BrokerResponse> {
    const latency = this.faultConfig.simulated_latency_ms ?? 5;
    await new Promise(r => setTimeout(r, latency));

    const broker_order_id = `paper-ord-${request.order_request_id.slice(0, 8)}`;
    const received_at = new Date();

    // Check if we force a status
    if (this.faultConfig.force_status) {
      const forcedStatus = this.faultConfig.force_status;
      this.orders.set(request.idempotency_key, {
        request,
        status: forcedStatus,
        filled_qty: 0,
        broker_order_id,
      });

      return {
        response_id: `paper-resp-${Math.random().toString(36).slice(2, 9)}`,
        order_request_id: request.order_request_id,
        broker_order_id: forcedStatus === 'REJECTED' ? null : broker_order_id,
        raw_status: forcedStatus,
        normalized_status: forcedStatus,
        reject_reason: forcedStatus === 'REJECTED' ? (this.faultConfig.forced_reject_reason ?? 'Forced rejection') : null,
        retryable: forcedStatus === 'ACK_AMBIGUOUS' || forcedStatus === 'REJECTED',
        latency_ms: latency,
        received_at,
        raw_payload: { fault_injected: true },
      };
    }

    // Default: Immediate full fill or partial fill simulation
    const isPartial = this.faultConfig.partial_fill_ratio !== undefined;
    const initialStatus = isPartial ? 'PARTIALLY_FILLED' : 'FILLED';
    const filledQty = isPartial ? Math.floor(request.qty * this.faultConfig.partial_fill_ratio!) : request.qty;

    this.orders.set(request.idempotency_key, {
      request,
      status: initialStatus,
      filled_qty: filledQty,
      broker_order_id,
    });

    // Trigger fill events asynchronously on the stream
    if (this.onFillCallback && filledQty > 0) {
      setTimeout(() => {
        const fill: FillEvent = {
          fill_id: `paper-fill-${Math.random().toString(36).slice(2, 9)}`,
          order_request_id: request.order_request_id,
          broker_fill_id: `paper-bfill-${request.order_request_id.slice(0, 8)}-1`,
          fill_qty: filledQty,
          fill_price: request.price ?? 100.0, // default if market
          commission: 20.0,
          is_partial: isPartial,
          slippage: {
            expected_price: request.price ?? 100.0,
            actual_price: request.price ?? 100.0,
            slippage_abs: 0,
            slippage_bps: 0,
            direction: 'NEUTRAL',
          },
          exchange_ts: new Date(),
          received_ts: new Date(),
        };
        this.onFillCallback!(fill);

        // If it was partial, trigger the second fill closing the remainder shortly after
        if (isPartial && filledQty < request.qty) {
          setTimeout(() => {
            const remainder = request.qty - filledQty;
            const record = this.orders.get(request.idempotency_key);
            if (record && record.status !== 'CANCELLED') {
              record.status = 'FILLED';
              record.filled_qty = request.qty;
              this.onFillCallback!({
                fill_id: `paper-fill-${Math.random().toString(36).slice(2, 9)}`,
                order_request_id: request.order_request_id,
                broker_fill_id: `paper-bfill-${request.order_request_id.slice(0, 8)}-2`,
                fill_qty: remainder,
                fill_price: request.price ?? 100.0,
                commission: 20.0,
                is_partial: false,
                slippage: {
                  expected_price: request.price ?? 100.0,
                  actual_price: request.price ?? 100.0,
                  slippage_abs: 0,
                  slippage_bps: 0,
                  direction: 'NEUTRAL',
                },
                exchange_ts: new Date(),
                received_ts: new Date(),
              });
            }
          }, 50);
        }
      }, 10);
    }

    return {
      response_id: `paper-resp-${Math.random().toString(36).slice(2, 9)}`,
      order_request_id: request.order_request_id,
      broker_order_id,
      raw_status: initialStatus,
      normalized_status: initialStatus,
      reject_reason: null,
      retryable: false,
      latency_ms: latency,
      received_at,
      raw_payload: { paper: true },
    };
  }

  async cancelOrder(ref: OrderReference): Promise<BrokerResponse> {
    const latency = this.faultConfig.simulated_latency_ms ?? 5;
    await new Promise(r => setTimeout(r, latency));

    const record = this.orders.get(ref.idempotency_key);
    const received_at = new Date();

    if (!record) {
      return {
        response_id: `paper-resp-err`,
        order_request_id: '',
        broker_order_id: null,
        raw_status: 'REJECTED',
        normalized_status: 'REJECTED',
        reject_reason: 'Order not found for cancellation',
        retryable: false,
        latency_ms: latency,
        received_at,
        raw_payload: {},
      };
    }

    record.status = 'CANCELLED';

    return {
      response_id: `paper-resp-${Math.random().toString(36).slice(2, 9)}`,
      order_request_id: record.request.order_request_id,
      broker_order_id: record.broker_order_id,
      raw_status: 'CANCELLED',
      normalized_status: 'CANCELLED',
      reject_reason: null,
      retryable: false,
      latency_ms: latency,
      received_at,
      raw_payload: {},
    };
  }

  async getOrderStatus(ref: OrderReference): Promise<BrokerResponse> {
    const latency = this.faultConfig.simulated_latency_ms ?? 5;
    await new Promise(r => setTimeout(r, latency));

    const record = this.orders.get(ref.idempotency_key);
    const received_at = new Date();

    if (!record) {
      // Simulate "genuine absence" at broker, mapped to REJECTED (retryable)
      return {
        response_id: `paper-resp-reconcile-miss`,
        order_request_id: '',
        broker_order_id: null,
        raw_status: 'REJECTED',
        normalized_status: 'REJECTED',
        reject_reason: 'Order not found at broker',
        retryable: true,
        latency_ms: latency,
        received_at,
        raw_payload: {},
      };
    }

    return {
      response_id: `paper-resp-${Math.random().toString(36).slice(2, 9)}`,
      order_request_id: record.request.order_request_id,
      broker_order_id: record.broker_order_id,
      raw_status: record.status,
      normalized_status: record.status,
      reject_reason: record.status === 'REJECTED' ? 'Order failed' : null,
      retryable: record.status === 'REJECTED',
      latency_ms: latency,
      received_at,
      raw_payload: {},
    };
  }

  streamFills(
    onFill: (fill: FillEvent) => void,
    onError: (err: BrokerStreamError) => void
  ): BrokerSubscription {
    this.onFillCallback = onFill;
    this.onErrorCallback = onError;

    return {
      subscription_id: 'paper-sub-1',
      unsubscribe: () => {
        this.onFillCallback = undefined;
        this.onErrorCallback = undefined;
      },
    };
  }
}
