/**
 * packages/phase7-broker/src/adapters/DhanBrokerAdapter.ts
 * Artha AI — Phase 7 Dhan Broker Adapter
 *
 * API Docs: https://dhanhq.co/docs/v2/
 * Auth: Static access_token generated from developer portal
 */

import { IBrokerAdapter, OrderReference, BrokerSubscription, BrokerStreamError } from '../contracts/IBrokerAdapter';
import { OrderRequest, BrokerResponse, FillEvent } from '../types/domain';

export class DhanBrokerAdapter implements IBrokerAdapter {
  readonly adapter_mode = 'LIVE';
  private readonly clientId: string;
  private readonly accessToken: string;

  constructor(clientId: string, accessToken: string) {
    this.clientId = clientId;
    this.accessToken = accessToken;
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'access-token': this.accessToken,
      'client-id': this.clientId,
    };
  }

  private isSandboxMode(): boolean {
    return !this.accessToken || this.accessToken.startsWith('YOUR_') || this.accessToken.startsWith('simulated-');
  }

  async placeOrder(request: OrderRequest): Promise<BrokerResponse> {
    const startTime = Date.now();

    // Dhan uses SECURITY_ID (NSE token number) — for now use symbol name
    const body = {
      dhanClientId: this.clientId,
      correlationId: request.idempotency_key.substring(0, 25),
      transactionType: request.broker_direction, // BUY or SELL
      exchangeSegment: 'NSE_EQ',
      productType: request.product_type === 'MIS' ? 'INTRADAY' : 'CNC',
      orderType: request.order_type === 'MARKET' ? 'MARKET' : 'LIMIT',
      validity: 'DAY',
      securityId: request.symbol_id, // should be NSE security ID (token) in production
      quantity: request.qty,
      price: request.order_type === 'LIMIT' ? request.price : 0,
      disclosedQuantity: 0,
      afterMarketOrder: false,
    };

    if (this.isSandboxMode()) {
      console.log(`[DhanAdapter] Simulated: ${request.broker_direction} ${request.qty} ${request.symbol_id}`);
      return {
        response_id: `resp-dhan-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: `dhn-${Math.random().toString(36).substring(2, 11)}`,
        raw_status: 'success',
        normalized_status: 'OPEN',
        reject_reason: null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: body
      };
    }

    try {
      const res = await fetch('https://api.dhan.co/v2/orders', {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body)
      });
      const data = await res.json() as any;
      const success = res.ok && data?.orderId;

      return {
        response_id: `resp-dhan-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: success ? data.orderId : null,
        raw_status: success ? 'success' : 'error',
        normalized_status: success ? 'OPEN' : 'REJECTED',
        reject_reason: success ? null : (data.errorMessage || 'API error'),
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-dhan-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: null,
        raw_status: 'EXCEPTION',
        normalized_status: 'REJECTED',
        reject_reason: err.message,
        retryable: true,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {}
      };
    }
  }

  async cancelOrder(ref: OrderReference): Promise<BrokerResponse> {
    const startTime = Date.now();
    if (this.isSandboxMode()) {
      return {
        response_id: `resp-dhan-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-cancel',
        broker_order_id: ref.broker_order_id || null,
        raw_status: 'success',
        normalized_status: 'CANCELLED',
        reject_reason: null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {}
      };
    }

    try {
      const res = await fetch(`https://api.dhan.co/v2/orders/${ref.broker_order_id}`, {
        method: 'DELETE',
        headers: this.headers
      });
      const data = await res.json() as any;
      const success = res.ok;

      return {
        response_id: `resp-dhan-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-cancel',
        broker_order_id: ref.broker_order_id || null,
        raw_status: success ? 'success' : 'error',
        normalized_status: success ? 'CANCELLED' : 'OPEN',
        reject_reason: success ? null : data?.errorMessage,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-dhan-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-cancel',
        broker_order_id: ref.broker_order_id || null,
        raw_status: 'EXCEPTION',
        normalized_status: 'OPEN',
        reject_reason: err.message,
        retryable: true,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {}
      };
    }
  }

  async getOrderStatus(ref: OrderReference): Promise<BrokerResponse> {
    const startTime = Date.now();
    if (this.isSandboxMode()) {
      return {
        response_id: `resp-dhan-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-status',
        broker_order_id: ref.broker_order_id || null,
        raw_status: 'TRADED',
        normalized_status: 'FILLED',
        reject_reason: null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {}
      };
    }

    try {
      const res = await fetch(`https://api.dhan.co/v2/orders/${ref.broker_order_id}`, {
        headers: this.headers
      });
      const data = await res.json() as any;
      const rawStatus = data?.orderStatus;

      let normalized: any = 'OPEN';
      if (rawStatus === 'TRADED') normalized = 'FILLED';
      else if (rawStatus === 'CANCELLED') normalized = 'CANCELLED';
      else if (rawStatus === 'REJECTED') normalized = 'REJECTED';

      return {
        response_id: `resp-dhan-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-status',
        broker_order_id: ref.broker_order_id || null,
        raw_status: rawStatus || 'UNKNOWN',
        normalized_status: normalized,
        reject_reason: normalized === 'REJECTED' ? data?.orderStatusMessage : null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-dhan-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-status',
        broker_order_id: ref.broker_order_id || null,
        raw_status: 'EXCEPTION',
        normalized_status: 'OPEN',
        reject_reason: err.message,
        retryable: true,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {}
      };
    }
  }

  streamFills(onFill: (fill: FillEvent) => void, onError: (err: BrokerStreamError) => void): BrokerSubscription {
    const subId = `dhan-sub-${Math.random().toString(36).substring(2, 11)}`;
    console.log(`[DhanAdapter] WebSocket: wss://api-orderalert.dhan.co — subscription: ${subId}`);
    return { subscription_id: subId, unsubscribe: () => {} };
  }
}
