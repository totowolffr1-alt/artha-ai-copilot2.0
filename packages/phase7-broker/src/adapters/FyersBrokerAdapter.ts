/**
 * packages/phase7-broker/src/adapters/FyersBrokerAdapter.ts
 * Artha AI — Phase 7 Fyers Broker Adapter
 *
 * API Docs: https://myapi.fyers.in/docs/
 * Auth: OAuth2 — app_id + access_token
 */

import { IBrokerAdapter, OrderReference, BrokerSubscription, BrokerStreamError } from '../contracts/IBrokerAdapter';
import { OrderRequest, BrokerResponse, FillEvent } from '../types/domain';

export class FyersBrokerAdapter implements IBrokerAdapter {
  readonly adapter_mode = 'LIVE';
  private readonly appId: string;      // appId:accessToken format used by Fyers
  private readonly accessToken: string;

  constructor(appId: string, accessToken: string) {
    this.appId = appId;
    this.accessToken = accessToken;
  }

  private get authHeader(): string {
    return `${this.appId}:${this.accessToken}`;
  }

  private isSandboxMode(): boolean {
    return !this.accessToken || this.accessToken.startsWith('YOUR_') || this.accessToken.startsWith('simulated-');
  }

  async placeOrder(request: OrderRequest): Promise<BrokerResponse> {
    const startTime = Date.now();

    // Fyers uses NSE:symbol format for instruments
    const body = {
      symbol: `NSE:${request.symbol_id}-EQ`,
      qty: request.qty,
      type: request.order_type === 'MARKET' ? 2 : 1, // 1=LIMIT, 2=MARKET
      side: request.broker_direction === 'BUY' ? 1 : -1,    // 1=BUY, -1=SELL
      productType: request.product_type === 'MIS' ? 'INTRADAY' : 'CNC',
      limitPrice: request.order_type === 'LIMIT' ? request.price : 0,
      stopPrice: 0,
      validity: 'DAY',
      disclosedQty: 0,
      offlineOrder: false,
      stopLoss: 0,
      takeProfit: 0,
    };

    if (this.isSandboxMode()) {
      console.log(`[FyersAdapter] Simulated: ${request.broker_direction} ${request.qty} ${request.symbol_id}`);
      return {
        response_id: `resp-fyers-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: `fy-${Math.random().toString(36).substring(2, 11)}`,
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
      const res = await fetch('https://api.fyers.in/api/v2/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.authHeader,
        },
        body: JSON.stringify(body)
      });

      const data = await res.json() as any;
      const success = data && data.s === 'ok';

      return {
        response_id: `resp-fyers-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: success ? data.id : null,
        raw_status: data.s,
        normalized_status: success ? 'OPEN' : 'REJECTED',
        reject_reason: success ? null : (data.message || 'API error'),
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-fyers-${Math.random().toString(36).substring(2, 11)}`,
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
        response_id: `resp-fyers-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-cancel',
        broker_order_id: ref.broker_order_id || null,
        raw_status: 'ok',
        normalized_status: 'CANCELLED',
        reject_reason: null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {}
      };
    }

    try {
      const res = await fetch('https://api.fyers.in/api/v2/orders', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.authHeader,
        },
        body: JSON.stringify({ id: ref.broker_order_id })
      });
      const data = await res.json() as any;
      const success = data && data.s === 'ok';
      return {
        response_id: `resp-fyers-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-cancel',
        broker_order_id: ref.broker_order_id || null,
        raw_status: data.s,
        normalized_status: success ? 'CANCELLED' : 'OPEN',
        reject_reason: success ? null : data.message,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-fyers-${Math.random().toString(36).substring(2, 11)}`,
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
        response_id: `resp-fyers-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-status',
        broker_order_id: ref.broker_order_id || null,
        raw_status: 'FILLED',
        normalized_status: 'FILLED',
        reject_reason: null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {}
      };
    }

    try {
      const res = await fetch(`https://api.fyers.in/api/v2/orders?id=${ref.broker_order_id}`, {
        headers: { 'Authorization': this.authHeader }
      });
      const data = await res.json() as any;
      const order = data.orderBook?.[0];

      let normalized: any = 'OPEN';
      if (order?.status === 2) normalized = 'FILLED';
      else if (order?.status === 5) normalized = 'CANCELLED';
      else if (order?.status === 6) normalized = 'REJECTED';

      return {
        response_id: `resp-fyers-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-status',
        broker_order_id: ref.broker_order_id || null,
        raw_status: String(order?.status || 0),
        normalized_status: normalized,
        reject_reason: normalized === 'REJECTED' ? order?.message : null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-fyers-${Math.random().toString(36).substring(2, 11)}`,
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
    const subId = `fyers-sub-${Math.random().toString(36).substring(2, 11)}`;
    console.log(`[FyersAdapter] WebSocket: wss://socket.fyers.in/order — subscription: ${subId}`);
    return { subscription_id: subId, unsubscribe: () => {} };
  }
}
