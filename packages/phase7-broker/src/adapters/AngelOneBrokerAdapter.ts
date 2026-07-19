/**
 * packages/phase7-broker/src/adapters/AngelOneBrokerAdapter.ts
 * Artha AI — Phase 7 Angel One Broker Adapter
 */

import { IBrokerAdapter, OrderReference, BrokerSubscription, BrokerStreamError } from '../contracts/IBrokerAdapter';
import { OrderRequest, BrokerResponse, FillEvent, OrderStatus } from '../types/domain';
import { AngelOneAuthManager } from './AngelOneAuthManager';
import { AngelOneOrderMapper } from './AngelOneOrderMapper';
import { AngelOneFillMapper } from './AngelOneFillMapper';

export class AngelOneBrokerAdapter implements IBrokerAdapter {
  readonly adapter_mode = 'LIVE';
  private readonly authManager: AngelOneAuthManager;
  private readonly symbolTokenMap = new Map<string, string>([
    ['RELIANCE', '2885'],
    ['TCS', '11536'],
    ['INFY', '1594'],
    ['HDFCBANK', '1333']
  ]);

  constructor(
    clientId: string,
    clientSecret: string,
    passwordSecret: string,
    totpSecret: string
  ) {
    this.authManager = new AngelOneAuthManager(clientId, clientSecret, passwordSecret, totpSecret);
  }

  async placeOrder(request: OrderRequest): Promise<BrokerResponse> {
    const symbolToken = this.symbolTokenMap.get(request.symbol_id) || '99999';
    const body = AngelOneOrderMapper.mapToAngelOne(request, symbolToken);
    
    const startTime = Date.now();
    const token = await this.authManager.getAuthToken();

    if (token === 'offline-session-fallback' || token.startsWith('simulated-')) {
      // Offline fallback: Return mock successful broker response
      console.log(`[AngelOneAdapter] Simulated Place Order for ${request.symbol_id} - Qty: ${request.qty}`);
      return {
        response_id: `resp-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: `brk-${Math.random().toString(36).substring(2, 11)}`,
        raw_status: 'SUCCESS',
        normalized_status: 'OPEN',
        reject_reason: null,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: { variety: body.variety, tradingsymbol: body.tradingsymbol }
      };
    }

    try {
      const res = await fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/placeOrder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientIP': '127.0.0.1',
          'X-MACAddress': '00-00-00-00-00-00',
          'X-PrivateKey': 'your_app_api_key' // uses private client key
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      const success = data && data.status === true;

      return {
        response_id: `resp-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: success ? data.data.orderid : null,
        raw_status: data.message || 'FAILED',
        normalized_status: success ? 'OPEN' : 'REJECTED',
        reject_reason: success ? null : (data.message || 'API error'),
        retryable: !success && data.errorcode === 'AB1005', // example retryable error code
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-${Math.random().toString(36).substring(2, 11)}`,
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
    const token = await this.authManager.getAuthToken();

    if (token === 'offline-session-fallback' || token.startsWith('simulated-')) {
      return {
        response_id: `resp-${Math.random().toString(36).substring(2, 11)}`,
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
      const res = await fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/cancelOrder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-UserType': 'USER',
          'X-SourceID': 'WEB'
        },
        body: JSON.stringify({
          variety: 'NORMAL',
          orderid: ref.broker_order_id
        })
      });

      const data = await res.json();
      const success = data && data.status === true;

      return {
        response_id: `resp-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'logical-cancel',
        broker_order_id: ref.broker_order_id || null,
        raw_status: data.message || 'FAILED',
        normalized_status: success ? 'CANCELLED' : 'OPEN',
        reject_reason: success ? null : data.message,
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-${Math.random().toString(36).substring(2, 11)}`,
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
    const token = await this.authManager.getAuthToken();

    if (token === 'offline-session-fallback' || token.startsWith('simulated-')) {
      return {
        response_id: `resp-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'status-query',
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
      const res = await fetch(`https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/details/${ref.broker_order_id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-UserType': 'USER',
          'X-SourceID': 'WEB'
        }
      });

      const data = await res.json();
      const success = data && data.status === true && data.data;

      let normalized_status: OrderStatus = 'OPEN';
      if (success) {
        const rawStatus = data.data.status?.toLowerCase();
        if (rawStatus === 'complete' || rawStatus === 'filled') normalized_status = 'FILLED';
        else if (rawStatus === 'rejected') normalized_status = 'REJECTED';
        else if (rawStatus === 'cancelled') normalized_status = 'CANCELLED';
      }

      return {
        response_id: `resp-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'status-query',
        broker_order_id: ref.broker_order_id || null,
        raw_status: success ? data.data.status : 'FAILED',
        normalized_status,
        reject_reason: success ? data.data.text : 'API error',
        retryable: false,
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: data
      };
    } catch (err: any) {
      return {
        response_id: `resp-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: 'status-query',
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
    const subscription_id = `sub-${Math.random().toString(36).substring(2, 11)}`;
    let active = true;

    // Stream polling: check order log every 2 seconds
    const interval = setInterval(async () => {
      if (!active) return;
      
      const token = await this.authManager.getAuthToken();
      if (token === 'offline-session-fallback' || token.startsWith('simulated-')) {
        // Offline demo loop: randomly generate a mock fill occasionally
        if (Math.random() > 0.8) {
          const mockFill = AngelOneFillMapper.mapToFill(
            `req-${Math.random().toString(36).substring(2, 11)}`,
            { orderid: `brk-${Math.random().toString(36).substring(2, 11)}`, averageprice: '2895.00', filledshares: '10', status: 'complete', transactiontype: 'BUY' },
            2890.00
          );
          onFill(mockFill);
        }
        return;
      }

      try {
        const res = await fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/getOrderBook', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-UserType': 'USER',
            'X-SourceID': 'WEB'
          }
        });

        const data = await res.json();
        if (data && data.status === true && Array.isArray(data.data)) {
          // Process completed orders in response list
          for (const order of data.data) {
            if (order.status?.toLowerCase() === 'complete') {
              const fill = AngelOneFillMapper.mapToFill(
                `req-${order.orderid}`,
                order,
                parseFloat(order.price) || 0
              );
              onFill(fill);
            }
          }
        }
      } catch (err: any) {
        onError({
          cause: 'CONNECTION_LOST',
          occurred_at: new Date(),
          recoverable: true
        });
      }
    }, 2000);

    return {
      subscription_id,
      unsubscribe: () => {
        active = false;
        clearInterval(interval);
      }
    };
  }
}
