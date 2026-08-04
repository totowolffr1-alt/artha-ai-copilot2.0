/**
 * packages/phase7-broker/src/adapters/UpstoxBrokerAdapter.ts
 * Artha AI — Phase 7 Upstox Broker Adapter
 */

import { IBrokerAdapter, OrderReference, BrokerSubscription, BrokerStreamError } from '../contracts/IBrokerAdapter';
import { OrderRequest, BrokerResponse, FillEvent } from '../types/domain';

export class UpstoxBrokerAdapter implements IBrokerAdapter {
  readonly adapter_mode = 'LIVE';
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken || '';
  }

  async placeOrder(request: OrderRequest): Promise<BrokerResponse> {
    const startTime = Date.now();

    // Map order type
    const orderType = request.order_type === 'MARKET' ? 'MARKET' : 'LIMIT';
    const product = request.product_type === 'MIS' ? 'I' : 'D';

    const body = {
      quantity: request.qty,
      product: product,
      validity: 'DAY',
      price: request.order_type === 'LIMIT' ? request.price : 0,
      tag: request.idempotency_key,
      instrument_token: `NSE_EQ|${request.symbol_id}`, // Upstox NSE Equities format
      order_type: orderType,
      transaction_type: request.broker_direction,
      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false
    };

    if (!this.accessToken || this.accessToken.startsWith('YOUR_') || this.accessToken.startsWith('simulated-')) {
      // Offline fallback: Return mock successful broker response
      console.log(`[UpstoxAdapter] Simulated Place Order for ${request.symbol_id} - Qty: ${request.qty}`);
      return {
        response_id: `resp-upstox-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: `upk-${Math.random().toString(36).substring(2, 11)}`,
        raw_status: 'SUCCESS',
        normalized_status: 'OPEN',
        reject_reason: null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: body
      };
    }

    try {
      const res = await fetch('https://api-v2.upstox.com/order/place', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`
        },
        body: JSON.stringify(body)
      });

      const data = await res.json() as any;
      const success = data && data.status === 'success';

      return {
        response_id: `resp-upstox-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: success ? data.data.order_id : null,
        raw_status: data.status || 'FAILED',
        normalized_status: success ? 'OPEN' : 'REJECTED',
        reject_reason: success ? null : (data.errors?.[0]?.message || 'API error'),
        retryable: !success && data.errors?.[0]?.errorCode === 'UD1005',
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-upstox-${Math.random().toString(36).substring(2, 11)}`,
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

    if (!this.accessToken || this.accessToken.startsWith('YOUR_') || this.accessToken.startsWith('simulated-')) {
      return {
        response_id: `resp-upstox-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-cancel',
        broker_order_id: ref.broker_order_id || null,
        raw_status: 'SUCCESS',
        normalized_status: 'CANCELLED',
        reject_reason: null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {}
      };
    }

    try {
      const res = await fetch(`https://api-v2.upstox.com/order/cancel?order_id=${ref.broker_order_id}`, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      const data = await res.json() as any;
      const success = data && data.status === 'success';

      return {
        response_id: `resp-upstox-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-cancel',
        broker_order_id: ref.broker_order_id || null,
        raw_status: data.status || 'FAILED',
        normalized_status: success ? 'CANCELLED' : 'OPEN',
        reject_reason: success ? null : (data.errors?.[0]?.message || 'API error'),
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-upstox-${Math.random().toString(36).substring(2, 11)}`,
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

    if (!this.accessToken || this.accessToken.startsWith('YOUR_') || this.accessToken.startsWith('simulated-')) {
      return {
        response_id: `resp-upstox-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-status',
        broker_order_id: ref.broker_order_id || null,
        raw_status: 'SUCCESS',
        normalized_status: 'FILLED',
        reject_reason: null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {}
      };
    }

    try {
      const res = await fetch(`https://api-v2.upstox.com/order/history?order_id=${ref.broker_order_id}`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      const data = await res.json() as any;
      const success = data && data.status === 'success';
      const order = data.data?.[0];

      let normalizedStatus: any = 'OPEN';
      if (order?.status === 'complete') normalizedStatus = 'FILLED';
      else if (order?.status === 'cancelled') normalizedStatus = 'CANCELLED';
      else if (order?.status === 'rejected') normalizedStatus = 'REJECTED';

      return {
        response_id: `resp-upstox-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-status',
        broker_order_id: ref.broker_order_id || null,
        raw_status: order?.status || 'UNKNOWN',
        normalized_status: normalizedStatus,
        reject_reason: order?.status === 'rejected' ? order?.status_message : null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-upstox-${Math.random().toString(36).substring(2, 11)}`,
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

  streamFills(
    onFill: (fill: FillEvent) => void,
    onError: (err: BrokerStreamError) => void
  ): BrokerSubscription {
    const subId = `upstox-sub-${Math.random().toString(36).substring(2, 11)}`;
    console.log(`[UpstoxAdapter] Starting Fill Stream: ${subId}`);

    // Simulated fill loop for testing
    const interval = setInterval(() => {
      // Simulate check of open trades if needed
    }, 5000);

    return {
      subscription_id: subId,
      unsubscribe: () => {
        clearInterval(interval);
        console.log(`[UpstoxAdapter] Unsubscribed: ${subId}`);
      }
    };
  }
}
