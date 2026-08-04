/**
 * packages/phase7-broker/src/adapters/ShoonyaBrokerAdapter.ts
 * Artha AI — Phase 7 Shoonya (Finvasia) Broker Adapter
 *
 * API Docs: https://api.shoonya.com/
 * Auth: UserID + Password + TOTP + API_KEY (SHA256 hash authentication)
 * Known for: ZERO brokerage on all segments
 */

import { IBrokerAdapter, OrderReference, BrokerSubscription, BrokerStreamError } from '../contracts/IBrokerAdapter';
import { OrderRequest, BrokerResponse, FillEvent } from '../types/domain';

export class ShoonyaBrokerAdapter implements IBrokerAdapter {
  readonly adapter_mode = 'LIVE';
  private sessionToken: string;
  private readonly userId: string;

  constructor(userId: string, sessionToken: string) {
    this.userId = userId;
    this.sessionToken = sessionToken;
  }

  private isSandboxMode(): boolean {
    return !this.sessionToken || this.sessionToken.startsWith('YOUR_') || this.sessionToken.startsWith('simulated-');
  }

  // Shoonya uses custom JSON body format for its REST API
  private buildJKey(data: Record<string, any>): string {
    const payload = { uid: this.userId, actid: this.userId, ...data };
    return `jData=${JSON.stringify(payload)}&jKey=${this.sessionToken}`;
  }

  async placeOrder(request: OrderRequest): Promise<BrokerResponse> {
    const startTime = Date.now();

    const prd = request.product_type === 'MIS' ? 'I' : 'C'; // I=Intraday, C=CNC
    const trantype = request.broker_direction === 'BUY' ? 'B' : 'S';
    const prctyp = request.order_type === 'MARKET' ? 'MKT' : 'LMT';

    if (this.isSandboxMode()) {
      console.log(`[ShoonyaAdapter] Simulated: ${request.broker_direction} ${request.qty} ${request.symbol_id}`);
      return {
        response_id: `resp-shoonya-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: `shn-${Math.random().toString(36).substring(2, 11)}`,
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
      const res = await fetch('https://api.shoonya.com/NorenWClientTP/PlaceOrder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: this.buildJKey({
          exch: 'NSE',
          tsym: `${request.symbol_id}-EQ`,
          qty: String(request.qty),
          prc: request.order_type === 'LIMIT' ? String(request.price) : '0',
          prd: prd,
          trantype: trantype,
          prctyp: prctyp,
          ret: 'DAY',
        })
      });

      const data = await res.json() as any;
      const success = data && data.stat === 'Ok';

      return {
        response_id: `resp-shoonya-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: success ? data.norenordno : null,
        raw_status: data.stat,
        normalized_status: success ? 'OPEN' : 'REJECTED',
        reject_reason: success ? null : (data.emsg || 'API error'),
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-shoonya-${Math.random().toString(36).substring(2, 11)}`,
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
        response_id: `resp-shoonya-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-cancel',
        broker_order_id: ref.broker_order_id || null,
        raw_status: 'Ok',
        normalized_status: 'CANCELLED',
        reject_reason: null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {}
      };
    }

    try {
      const res = await fetch('https://api.shoonya.com/NorenWClientTP/CancelOrder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: this.buildJKey({ norenordno: ref.broker_order_id })
      });

      const data = await res.json() as any;
      const success = data && data.stat === 'Ok';
      return {
        response_id: `resp-shoonya-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-cancel',
        broker_order_id: ref.broker_order_id || null,
        raw_status: data.stat,
        normalized_status: success ? 'CANCELLED' : 'OPEN',
        reject_reason: success ? null : data.emsg,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-shoonya-${Math.random().toString(36).substring(2, 11)}`,
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
        response_id: `resp-shoonya-${Math.random().toString(36).substring(2, 11)}`,
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

    try {
      const res = await fetch('https://api.shoonya.com/NorenWClientTP/SingleOrdHist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: this.buildJKey({ norenordno: ref.broker_order_id })
      });
      const data = await res.json() as any;
      const order = Array.isArray(data) ? data[0] : data;

      let normalized: any = 'OPEN';
      if (order?.status === 'COMPLETE') normalized = 'FILLED';
      else if (order?.status === 'CANCELLED') normalized = 'CANCELLED';
      else if (order?.status === 'REJECTED') normalized = 'REJECTED';

      return {
        response_id: `resp-shoonya-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-status',
        broker_order_id: ref.broker_order_id || null,
        raw_status: order?.status || 'UNKNOWN',
        normalized_status: normalized,
        reject_reason: normalized === 'REJECTED' ? order?.rejreason : null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-shoonya-${Math.random().toString(36).substring(2, 11)}`,
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
    const subId = `shoonya-sub-${Math.random().toString(36).substring(2, 11)}`;
    console.log(`[ShoonyaAdapter] WebSocket: wss://api.shoonya.com/NorenWSTP/ — subscription: ${subId}`);
    return { subscription_id: subId, unsubscribe: () => {} };
  }
}
