/**
 * packages/phase7-broker/src/adapters/AngelOneBrokerAdapter.ts
 * Artha AI — Phase 7 Angel One Broker Adapter
 */

import { IBrokerAdapter, OrderReference, BrokerSubscription, BrokerStreamError } from '../contracts/IBrokerAdapter';
import { OrderRequest, BrokerResponse, FillEvent, OrderStatus } from '../types/domain';
import { AngelOneAuthManager } from './AngelOneAuthManager';
import { AngelOneOrderMapper } from './AngelOneOrderMapper';
import { AngelOneFillMapper } from './AngelOneFillMapper';
import { TokenRegistry } from '../../../phase2-market-data/src/marketData/adapters/angelone/TokenRegistry';

export class AngelOneBrokerAdapter implements IBrokerAdapter {
  readonly adapter_mode = 'LIVE';
  private readonly authManager: AngelOneAuthManager;
  private readonly clientSecret: string;
  private readonly tokenRegistry = new TokenRegistry();
  /** Fallback hardcoded map for ultra-common symbols */
  private readonly symbolTokenMap = new Map<string, string>([
    ['RELIANCE', '2885'],
    ['TCS', '11536'],
    ['INFY', '1594'],
    ['HDFCBANK', '1333'],
    ['NIFTY', '26000'],
    ['BANKNIFTY', '26009'],
  ]);
  /** Cache resolved tokens at runtime to avoid repeated lookups */
  private readonly resolvedTokenCache = new Map<string, string>();

  constructor(
    clientId: string,
    clientSecret: string,
    passwordSecret: string,
    totpSecret: string
  ) {
    this.authManager = new AngelOneAuthManager(clientId, clientSecret, passwordSecret, totpSecret);
    this.clientSecret = clientSecret;
  }

  /**
   * Resolves a symbol to its Angel One instrument token using multiple strategies:
   * 1. Runtime cache (fastest)
   * 2. TokenRegistry (instrument master JSON)
   * 3. Angel One Symbol Search API (live fallback)
   * 4. Hardcoded map (emergency fallback)
   */
  private async resolveSymbolToken(symbol: string, authToken: string): Promise<string> {
    // 1. Runtime cache
    const cached = this.resolvedTokenCache.get(symbol);
    if (cached) return cached;

    // 2. TokenRegistry (downloads Angel One instrument master)
    try {
      const resToken = await this.tokenRegistry.resolve(symbol, 'NSE');
      if (resToken.ok) {
        this.resolvedTokenCache.set(symbol, resToken.value.token);
        return resToken.value.token;
      }
    } catch { /* fall through */ }

    // 3. Angel One Symbol Search API (real-time, no pre-download needed)
    try {
          const clientIp = (process.env.ANGELONE_STATIC_IP || process.env.SMARTAPI_STATIC_IP || '13.57.136.86').trim();
          const searchRes = await fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/searchScrip', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': `Bearer ${authToken}`,
              'X-UserType': 'USER',
              'X-SourceID': 'WEB',
              'X-ClientIP': clientIp,
              'X-LocalIP': clientIp,
              'clientlocalip': clientIp,
              'clientpublicip': clientIp,
              'X-MACAddress': '00-00-00-00-00-00',
              'X-PrivateKey': this.clientSecret,
            },
            body: JSON.stringify({ exchange: 'NSE', searchscrip: symbol })
          });
      const searchData = await searchRes.json() as any;
      if (searchData?.status === true && Array.isArray(searchData.data) && searchData.data.length > 0) {
        // Find exact match (prefer -EQ equity type)
        const match = searchData.data.find((s: any) =>
          s.tradingsymbol === `${symbol}-EQ` || s.tradingsymbol === symbol
        ) || searchData.data[0];
        if (match?.symboltoken) {
          console.log(`[AngelOneAdapter] Resolved ${symbol} → token ${match.symboltoken} via search API`);
          this.resolvedTokenCache.set(symbol, match.symboltoken);
          return match.symboltoken;
        }
      }
    } catch (e) {
      console.warn(`[AngelOneAdapter] Symbol search API failed for ${symbol}:`, e);
    }

    // 4. Hardcoded map fallback
    const hardcoded = this.symbolTokenMap.get(symbol);
    if (hardcoded) return hardcoded;

    // Return empty string — will cause meaningful rejection from Angel One
    console.error(`[AngelOneAdapter] Could not resolve symbol token for: ${symbol}`);
    return '';
  }

  async placeOrder(request: OrderRequest): Promise<BrokerResponse> {
    const startTime = Date.now();
    const token = await this.authManager.getAuthToken();

    // Resolve symbol token AFTER getting auth token (search API needs it)
    const symbolToken = await this.resolveSymbolToken(request.symbol_id, token);
    const body = AngelOneOrderMapper.mapToAngelOne(request, symbolToken);

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
      const clientIp = (process.env.ANGELONE_STATIC_IP || process.env.SMARTAPI_STATIC_IP || '13.57.136.86').trim();
      const res = await fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/placeOrder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientIP': clientIp,
          'X-LocalIP': clientIp,
          'clientlocalip': clientIp,
          'clientpublicip': clientIp,
          'X-MACAddress': '00-00-00-00-00-00',
          'X-PrivateKey': this.clientSecret,
        },
        body: JSON.stringify(body)
      });

      const data = await res.json() as any;
      const success = data && data.status === true;
      const rejectReason = success ? null : (data.message || 'API error');

      // ── Detect IP-not-registered error ────────────────────────────────────────
      const isIpError =
        rejectReason &&
        (rejectReason.toLowerCase().includes('not a registered ip') ||
          rejectReason.toLowerCase().includes('ip address') ||
          data.errorcode === 'AB1011' ||
          data.errorcode === 'AG8002');

      let serverIp: string | null = null;
      if (isIpError) {
        try {
          const ipRes = await fetch('https://api.ipify.org?format=json');
          const ipData = await ipRes.json() as any;
          serverIp = ipData.ip || null;
        } catch {
          serverIp = null;
        }
      }
      // ──────────────────────────────────────────────────────────────────────────

      return {
        response_id: `resp-${Math.random().toString(36).substring(2, 11)}`,
        order_request_id: request.order_request_id,
        broker_order_id: success ? data.data.orderid : null,
        raw_status: data.message || 'FAILED',
        normalized_status: success ? 'OPEN' : 'REJECTED',
        reject_reason: rejectReason,
        retryable: !success && data.errorcode === 'AB1005', // example retryable error code
        latency_ms: Date.now() - startTime,
        received_at: new Date(),
        raw_payload: {
          ...data,
          ipWhitelistRequired: !!isIpError,
          serverIp,
        }
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

      const data = await res.json() as any;
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

      const data = await res.json() as any;
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

        const data = await res.json() as any;
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
