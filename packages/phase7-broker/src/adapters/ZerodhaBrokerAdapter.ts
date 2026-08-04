/**
 * packages/phase7-broker/src/adapters/ZerodhaBrokerAdapter.ts
 * Artha AI — Phase 7 Zerodha (Kite Connect) Broker Adapter
 *
 * API Docs: https://kite.trade/docs/connect/v3/
 * Auth: OAuth2 — requires api_key + access_token (generated after daily login)
 */

import { IBrokerAdapter, OrderReference, BrokerSubscription, BrokerStreamError } from '../contracts/IBrokerAdapter';
import { OrderRequest, BrokerResponse, FillEvent } from '../types/domain';

export class ZerodhaBrokerAdapter implements IBrokerAdapter {
  readonly adapter_mode = 'LIVE';
  private readonly apiKey: string;
  private readonly accessToken: string;

  constructor(apiKey: string, accessToken: string) {
    this.apiKey = apiKey;
    this.accessToken = accessToken;
  }

  private get headers() {
    return {
      'X-Kite-Version': '3',
      'Authorization': `token ${this.apiKey}:${this.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }

  private isSandboxMode(): boolean {
    return !this.accessToken || this.accessToken.startsWith('YOUR_') || this.accessToken.startsWith('simulated-');
  }

  async placeOrder(request: OrderRequest): Promise<BrokerResponse> {
    const startTime = Date.now();

    // Map variety, product, order_type
    const variety = 'regular';
    const product = request.product_type === 'MIS' ? 'MIS' : 'CNC';
    const orderType = request.order_type === 'MARKET' ? 'MARKET' : 'LIMIT';

    const params = new URLSearchParams({
      tradingsymbol: request.symbol_id,
      exchange: 'NSE',
      transaction_type: request.broker_direction, // BUY or SELL
      order_type: orderType,
      quantity: String(request.qty),
      product: product,
      price: request.order_type === 'LIMIT' ? String(request.price) : '0',
      validity: 'DAY',
      tag: request.idempotency_key.substring(0, 20),
    });

    if (this.isSandboxMode()) {
      console.log(`[ZerodhaAdapter] Simulated: ${request.broker_direction} ${request.qty} ${request.symbol_id}`);
      return {
        response_id: `resp-zerodha-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: `znse-${Math.random().toString(36).substring(2, 11)}`,
        raw_status: 'success',
        normalized_status: 'OPEN',
        reject_reason: null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {}
      };
    }

    try {
      const res = await fetch(`https://api.kite.trade/orders/${variety}`, {
        method: 'POST',
        headers: this.headers,
        body: params,
      });
      const data = await res.json() as any;
      const success = data && data.status === 'success';

      return {
        response_id: `resp-zerodha-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: success ? String(data.data.order_id) : null,
        raw_status: data.status,
        normalized_status: success ? 'OPEN' : 'REJECTED',
        reject_reason: success ? null : (data.message || 'API error'),
        retryable: !success && data.error_type === 'NetworkException',
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return this._errorResponse(request.order_request_id, err, startTime);
    }
  }

  async cancelOrder(ref: OrderReference): Promise<BrokerResponse> {
    const startTime = Date.now();
    if (this.isSandboxMode()) {
      return this._mockedCancel(ref, startTime);
    }

    try {
      const res = await fetch(`https://api.kite.trade/orders/regular/${ref.broker_order_id}`, {
        method: 'DELETE',
        headers: this.headers,
      });
      const data = await res.json() as any;
      const success = data && data.status === 'success';

      return {
        response_id: `resp-zerodha-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-cancel',
        broker_order_id: ref.broker_order_id || null,
        raw_status: data.status,
        normalized_status: success ? 'CANCELLED' : 'OPEN',
        reject_reason: success ? null : data.message,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return this._errorResponse('logical-cancel', err, startTime);
    }
  }

  async getOrderStatus(ref: OrderReference): Promise<BrokerResponse> {
    const startTime = Date.now();
    if (this.isSandboxMode()) return this._mockedFilled(ref, startTime);

    try {
      const res = await fetch(`https://api.kite.trade/orders/${ref.broker_order_id}`, {
        headers: this.headers,
      });
      const data = await res.json() as any;
      const success = data && data.status === 'success';
      const order = data.data?.[0];

      let normalized: any = 'OPEN';
      if (order?.status === 'COMPLETE') normalized = 'FILLED';
      else if (order?.status === 'CANCELLED') normalized = 'CANCELLED';
      else if (order?.status === 'REJECTED') normalized = 'REJECTED';

      return {
        response_id: `resp-zerodha-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-status',
        broker_order_id: ref.broker_order_id || null,
        raw_status: order?.status || 'UNKNOWN',
        normalized_status: normalized,
        reject_reason: order?.status === 'REJECTED' ? order?.status_message : null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return this._errorResponse('logical-status', err, startTime);
    }
  }

  streamFills(onFill: (fill: FillEvent) => void, onError: (err: BrokerStreamError) => void): BrokerSubscription {
    const subId = `zerodha-sub-${Math.random().toString(36).substring(2, 11)}`;
    console.log(`[ZerodhaAdapter] WebSocket ticker at wss://ws.kite.trade — subscription: ${subId}`);
    // Full WS integration: subscribe to Kite Ticker WebSocket (requires ws library in real deployment)
    return { subscription_id: subId, unsubscribe: () => {} };
  }

  private _errorResponse(reqId: string, err: Error, startTime: number): BrokerResponse {
    return {
      response_id: `resp-zerodha-${Math.random().toString(36).substring(2, 11)}`,
      order_request_id: reqId,
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

  private _mockedCancel(ref: OrderReference, startTime: number): BrokerResponse {
    return {
      response_id: `resp-zerodha-${Math.random().toString(36).substring(2, 11)}`,
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

  private _mockedFilled(ref: OrderReference, startTime: number): BrokerResponse {
    return {
      response_id: `resp-zerodha-${Math.random().toString(36).substring(2, 11)}`,
      order_request_id: 'logical-status',
      broker_order_id: ref.broker_order_id || null,
      raw_status: 'COMPLETE',
      normalized_status: 'FILLED',
      reject_reason: null,
      retryable: false,
      latency_ms: Date.now() - startTime,
      received_at: new Date(),
      raw_payload: {}
    };
  }
}
