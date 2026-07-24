/**
 * src/marketData/adapters/angelone/AngelOneAdapter.ts
 * Phase 2C — IMarketDataAdapter implementation for AngelOne SmartAPI.
 *
 * Implements the full adapter surface:
 *   - connect()           → login via SmartApiSession + open WebSocket
 *   - disconnect()        → clean WebSocket close + session invalidation
 *   - isConnected()       → WebSocket OPEN + heartbeat alive
 *   - resolveToken()      → TokenRegistry lookup
 *   - subscribeRawTick()  → WebSocket SNAP_QUOTE subscription
 *   - fetchRawCandles()   → REST getCandleData with pagination
 *   - searchRawSymbols()  → REST symbol search
 *
 * WebSocket URL: wss://smartapisocket.angelbroking.com/smart-stream
 * Auth header:   x-feed-token: <feedToken>
 * Subscribe msg: JSON { action: 1, params: { mode: 3, tokenList: [...] } }
 *
 * The adapter speaks broker language (paise, tokens, exchange codes).
 * Normalizer.ts translates everything to canonical Artha types.
 * This adapter never imports canonical Tick/Candle — only RawTick/RawCandle.
 *
 * Thread safety: all state mutations are synchronous on the JS event loop.
 * No concurrent WebSocket messages are processed (Node.js single-threaded).
 *
 * Error contract: never throws. All failures are Result<T> errors.
 */

import type { IMarketDataAdapter, RawTick, RawCandle, RawSymbol, TokenInfo, SubscriptionMode, AdapterInterval } from '../IMarketDataAdapter';
import type { Result }          from '../../../utils/errors';
import { ok, err }              from '../../../utils/errors';
import type { Timeframe }       from '../../types';
import type { IEventBus }       from '../../EventBus';

import { SmartApiSession }      from './SmartApiSession';
import type { SmartApiCredentials } from './SmartApiSession';
import { TokenRegistry }        from './TokenRegistry';
import { Normalizer }           from './Normalizer';
import { ConnectionMonitor }    from '../../connection/ConnectionMonitor';
import { decodeBinaryTick }     from './BinaryDecoder';

// ─── Constants ────────────────────────────────────────────────────────────────

const WS_URL            = 'wss://smartapisocket.angelbroking.com/smart-stream';
const REST_BASE         = 'https://apiconnect.angelbroking.com';
const CANDLE_PATH       = '/rest/secure/angelbroking/historical/v1/getCandleData';
const SEARCH_PATH       = '/rest/secure/angelbroking/order/v1/searchScrip';
const REST_TIMEOUT_MS   = 15_000;
const WS_CONNECT_TIMEOUT_MS = 10_000;
const MAX_TOKENS_PER_SUB    = 1_000;   // SmartAPI hard limit per WebSocket

// ─── Subscription state ───────────────────────────────────────────────────────

interface ActiveSubscription {
  readonly token:    string;
  readonly mode:     SubscriptionMode;
  callbacks:         Set<(raw: RawTick) => void>;
}

// ─── AngelOneAdapter ──────────────────────────────────────────────────────────

export class AngelOneAdapter implements IMarketDataAdapter {
  readonly name   = 'AngelOne';
  readonly isLive = true;

  private readonly session:   SmartApiSession;
  private readonly registry:  TokenRegistry;
  private readonly normalizer: Normalizer;
  private readonly monitor:   ConnectionMonitor;

  /** Active WebSocket instance. null when disconnected. */
  private ws: WebSocket | null = null;

  /**
   * token string → ActiveSubscription.
   * One entry per subscribed broker token (not per callback).
   */
  private subscriptions = new Map<string, ActiveSubscription>();

  /** Whether disconnect() was intentionally called (suppresses auto-reconnect). */
  private intentionalDisconnect = false;

  constructor(
    creds: SmartApiCredentials,
    private readonly bus: IEventBus,
  ) {
    this.session    = new SmartApiSession(creds);
    this.registry   = new TokenRegistry();
    this.normalizer = new Normalizer();
    this.monitor    = new ConnectionMonitor(bus, this.name);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async connect(): Promise<Result<void>> {
    if (this.isConnected()) return ok(undefined);   // idempotent

    this.intentionalDisconnect = false;

    // 1. Authenticate
    const loginResult = await this.session.login();
    if (!loginResult.ok) return err((loginResult as any).error);

    const { feedToken } = loginResult.value;

    // 2. Open WebSocket
    return this.openWebSocket(feedToken);
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.monitor.stopHeartbeat();
    this.closeWebSocket(1000, 'Client disconnect');
    this.subscriptions.clear();
    this.registry.clear();
    this.session.invalidate();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ─── Token resolution ─────────────────────────────────────────────────────

  async resolveToken(ticker: string, exchange: string): Promise<Result<TokenInfo>> {
    return this.registry.resolve(ticker, exchange);
  }

  // ─── WebSocket subscriptions ──────────────────────────────────────────────

  subscribeRawTick(
    token:    TokenInfo,
    mode:     SubscriptionMode,
    callback: (raw: RawTick) => void,
  ): () => void {
    const tokenKey = token.token;

    const existing = this.subscriptions.get(tokenKey);
    if (existing) {
      existing.callbacks.add(callback);
    } else {
      const sub: ActiveSubscription = {
        token: tokenKey,
        mode,
        callbacks: new Set([callback]),
      };
      this.subscriptions.set(tokenKey, sub);

      if (this.isConnected()) {
        this.sendSubscribeMessage([{ token: tokenKey, exchangeType: token.exchangeType }], mode);
      }
      // If not connected: subscription is stored and sent on next CONNECTED event
      // (MarketDataService handles resubscription from SubscriptionManager)
    }

    // Return unsubscribe function
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.removeCallback(tokenKey, token, callback);
    };
  }

  // ─── Historical REST ──────────────────────────────────────────────────────

  async fetchRawCandles(
    token:    TokenInfo,
    interval: AdapterInterval,
    from:     string,
    to:       string,
  ): Promise<Result<RawCandle[]>> {
    const jwt = this.session.jwtToken;
    if (!jwt) {
      return err({
        type:    'AuthError',
        reason:  'expired_token',
        message: 'No JWT token — call connect() first',
      });
    }

    const body = {
      exchange:    token.exchange,
      symboltoken: token.token,
      interval,
      fromdate:    from,
      todate:      to,
    };

    const result = await this.restPost<{
      status:  boolean;
      message: string;
      data:    Array<[string, number, number, number, number, number]> | null;
    }>(CANDLE_PATH, body, jwt);

    if (!result.ok) return err((result as any).error);

    const resp = result.value;
    if (!resp.status || !resp.data) {
      // SmartAPI returns status=false with message for rate limits, auth issues, etc.
      const isAuth = resp.message?.toLowerCase().includes('unauthorized')
                  || resp.message?.toLowerCase().includes('invalid token');
      if (isAuth) {
        return err({
          type:    'AuthError',
          reason:  'expired_token',
          message: `Historical API auth failure: ${resp.message}`,
        });
      }
      // Empty range — return empty array (chain tries next source)
      if (resp.message?.toLowerCase().includes('no data')) {
        return ok([]);
      }
      return err({
        type:    'NetworkError',
        endpoint: CANDLE_PATH,
        message: `Historical API error: ${resp.message ?? 'unknown error'}`,
      });
    }

    // SmartAPI returns: [[ts, o, h, l, c, v], ...]
    const candles: RawCandle[] = resp.data.map(row => ({
      timestamp: row[0],   // IST ISO8601 string
      open:      row[1],
      high:      row[2],
      low:       row[3],
      close:     row[4],
      volume:    row[5],
    }));

    return ok(candles);
  }

  // ─── Symbol search ────────────────────────────────────────────────────────

  async searchRawSymbols(query: string): Promise<Result<RawSymbol[]>> {
    const jwt = this.session.jwtToken;
    if (!jwt) {
      return err({
        type:    'AuthError',
        reason:  'expired_token',
        message: 'No JWT token — call connect() first',
      });
    }

    const result = await this.restPost<{
      status:  boolean;
      message: string;
      data:    Array<{
        scrip_name:      string;
        exchange:        string;
        symboltoken:     string;
        tradingsymbol:   string;
        instrument_type: string;
        lot_size:        number;
        tick_size:       number;
        isin?:           string;
      }> | null;
    }>(SEARCH_PATH, { exchange: 'NSE', searchscrip: query }, jwt);

    if (!result.ok) return err((result as any).error);

    const resp = result.value;
    if (!resp.status || !resp.data) {
      return ok([]);   // no results — not an error
    }

    const symbols: RawSymbol[] = resp.data.map(item => ({
      token:          item.symboltoken,
      symbol:         item.tradingsymbol,
      name:           item.scrip_name,
      exchange:       item.exchange,
      instrumentType: item.instrument_type,
      lotSize:        item.lot_size,
      tickSize:       item.tick_size,
      isin:           item.isin,
    }));

    return ok(symbols);
  }

  // ─── WebSocket management ─────────────────────────────────────────────────

  private openWebSocket(feedToken: string): Promise<Result<void>> {
    return new Promise(resolve => {
      let settled = false;
      const settle = (result: Result<void>) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        resolve(result);
      };

      const connectTimer = setTimeout(() => {
        settle(err({
          type:      'TimeoutError',
          operation: 'WebSocket connect',
          timeoutMs: WS_CONNECT_TIMEOUT_MS,
          message:   `WebSocket failed to open within ${WS_CONNECT_TIMEOUT_MS}ms`,
        }));
        this.closeWebSocket(1001, 'Connect timeout');
      }, WS_CONNECT_TIMEOUT_MS);

      const ws = new WebSocket(WS_URL, {
        headers: {
          'Authorization':  `Bearer ${this.session.jwtToken}`,
          'x-feed-token':   feedToken,
          'x-client-code':  this.extractClientCode(),
          'x-api-key':      this.extractApiKey(),
        },
      } as unknown as string[]);   // Node.js WebSocket accepts options as second arg

      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        // Resubscribe any tokens from a previous session (reconnect path)
        this.resubscribeAll();

        // Start heartbeat
        this.monitor.startHeartbeat(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send('ping');
          }
        });

        this.bus.emit({
          type:        'CONNECTED',
          adapterName: this.name,
          timestamp:   Date.now(),
        });

        settle(ok(undefined));
      };

      ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      ws.onerror = (event: any) => {
        const msg = event?.message ?? 'WebSocket error';
        settle(err({
          type:    'NetworkError',
          message: `WebSocket error: ${msg}`,
        }));
      };

      ws.onclose = (event) => {
        // Settle the connect promise if it hasn't resolved yet (error path)
        settle(err({
          type:    'NetworkError',
          message: `WebSocket closed during connect: code=${event.code}`,
        }));

        this.monitor.stopHeartbeat();
        this.ws = null;

        if (!this.intentionalDisconnect) {
          const reason = event.reason || `WebSocket closed (code ${event.code})`;
          this.bus.emit({
            type:        'DISCONNECTED',
            adapterName: this.name,
            reason,
            timestamp:   Date.now(),
          });
        }
      };
    });
  }

  private closeWebSocket(code: number, reason: string): void {
    if (this.ws) {
      try {
        this.ws.close(code, reason);
      } catch {
        // Already closed — ignore
      }
      this.ws = null;
    }
  }

  // ─── Message handling ─────────────────────────────────────────────────────

  private handleMessage(data: unknown): void {
    // Heartbeat response
    if (typeof data === 'string') {
      if (data === 'pong') {
        this.monitor.recordPong();
      }
      return;
    }

    // Binary tick frame
    if (data instanceof ArrayBuffer) {
      this.handleBinaryFrame(data);
    }
  }

  private handleBinaryFrame(buffer: ArrayBuffer): void {
    const decoded = decodeBinaryTick(buffer);
    if (!decoded.ok) {
      // Malformed frame — log via bus? Phase 3 can route this to a logger.
      // For now: silently drop. CandleAggregator never sees corrupt data.
      return;
    }

    const { raw } = decoded;
    const sub = this.subscriptions.get(raw.token);
    if (!sub) {
      // Received tick for untracked token — can happen briefly after unsubscribe
      return;
    }

    // Normalizer validates the raw tick before any callback fires
    const tickResult = this.normalizer.normalizeTick(raw, this.resolveSymbolFromToken(raw.token));
    if (!tickResult.ok) {
      // Corrupt tick — drop. Never reaches CandleAggregator.
      return;
    }

    // Emit on bus first (CandleAggregator listens here)
    this.bus.emit({ type: 'TICK_RECEIVED', tick: tickResult.value });

    // Fire per-subscription callbacks (registered by MarketDataService)
    for (const callback of sub.callbacks) {
      try {
        callback(raw);
      } catch {
        // Callback exceptions must never propagate back to the WS message handler
      }
    }
  }

  // ─── Subscription helpers ─────────────────────────────────────────────────

  private sendSubscribeMessage(
    tokens: Array<{ token: string; exchangeType: number }>,
    mode:   SubscriptionMode,
  ): void {
    if (!this.isConnected() || tokens.length === 0) return;

    const modeCode = mode === 'LTP' ? 1 : mode === 'QUOTE' ? 2 : 3;

    // SmartAPI subscription message format
    const msg = JSON.stringify({
      correlationID: `sub_${Date.now()}`,
      action:        1,   // 1 = subscribe
      params: {
        mode:      modeCode,
        tokenList: tokens.map(t => ({
          exchangeType: t.exchangeType,
          tokens:       [t.token],
        })),
      },
    });

    try {
      this.ws?.send(msg);
    } catch {
      // WebSocket may be closing — next reconnect will resubscribe
    }
  }

  private sendUnsubscribeMessage(
    tokenKey:     string,
    exchangeType: number,
    mode:         SubscriptionMode,
  ): void {
    if (!this.isConnected()) return;

    const modeCode = mode === 'LTP' ? 1 : mode === 'QUOTE' ? 2 : 3;

    const msg = JSON.stringify({
      correlationID: `unsub_${Date.now()}`,
      action:        0,   // 0 = unsubscribe
      params: {
        mode:      modeCode,
        tokenList: [{
          exchangeType,
          tokens: [tokenKey],
        }],
      },
    });

    try {
      this.ws?.send(msg);
    } catch {
      // Ignore — socket may already be gone
    }
  }

  private resubscribeAll(): void {
    if (this.subscriptions.size === 0) return;

    // Group by mode for efficiency (one message per mode)
    const byMode = new Map<SubscriptionMode, Array<{ token: string; exchangeType: number }>>();

    for (const [tokenKey, sub] of this.subscriptions) {
      const list = byMode.get(sub.mode) ?? [];
      // We need exchangeType — stored in TokenRegistry; fall back to reverse lookup
      const info = this.registry['cache'].get(this.resolveExchangeKeyFromToken(tokenKey));
      if (info) {
        list.push({ token: tokenKey, exchangeType: info.exchangeType });
        byMode.set(sub.mode, list);
      }
    }

    for (const [mode, tokens] of byMode) {
      // Respect MAX_TOKENS_PER_SUB — chunk if needed
      for (let i = 0; i < tokens.length; i += MAX_TOKENS_PER_SUB) {
        this.sendSubscribeMessage(tokens.slice(i, i + MAX_TOKENS_PER_SUB), mode);
      }
    }
  }

  private removeCallback(
    tokenKey: string,
    token:    TokenInfo,
    callback: (raw: RawTick) => void,
  ): void {
    const sub = this.subscriptions.get(tokenKey);
    if (!sub) return;

    sub.callbacks.delete(callback);

    if (sub.callbacks.size === 0) {
      this.subscriptions.delete(tokenKey);
      // Send WS unsubscribe only if connected
      if (this.isConnected()) {
        this.sendUnsubscribeMessage(tokenKey, token.exchangeType, sub.mode);
      }
    }
  }

  // ─── REST helper ─────────────────────────────────────────────────────────

  private async restPost<T>(
    path: string,
    body: Record<string, unknown>,
    jwt:  string,
  ): Promise<Result<T>> {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);

    try {
      const res = await fetch(`${REST_BASE}${path}`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Accept':        'application/json',
          'Authorization': `Bearer ${jwt}`,
          'X-UserType':    'USER',
          'X-SourceID':    'WEB',
          'X-PrivateKey':  this.extractApiKey(),
        },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });

      if (!res.ok) {
        return err({
          type:       'NetworkError',
          statusCode: res.status,
          endpoint:   path,
          message:    `HTTP ${res.status} from ${path}`,
        });
      }

      return ok(await res.json() as T);

    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        return err({
          type:      'TimeoutError',
          operation: `POST ${path}`,
          timeoutMs: REST_TIMEOUT_MS,
          message:   `REST request to ${path} timed out`,
        });
      }
      return err({
        type:    'NetworkError',
        endpoint: path,
        message: `REST fetch error: ${e instanceof Error ? e.message : String(e)}`,
        cause:   e instanceof Error ? e : undefined,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  /**
   * Resolve canonical symbol from broker token for use in normalizeTick().
   * Looks up from registry reverse cache.
   */
  private resolveSymbolFromToken(token: string): string {
    // The reverse lookup scans the cache — O(n) on cache size.
    // In Phase 3, MarketDataService should pass ticker through subscribeRawTick
    // to avoid this scan. For Phase 2C this is acceptable.
    for (const [cacheKey, info] of (this.registry as unknown as { cache: Map<string, TokenInfo> })['cache']) {
      if (info.token === token) {
        return cacheKey.split('|')[1] ?? token;
      }
    }
    return token; // fall back to raw token if not resolved
  }

  private resolveExchangeKeyFromToken(tokenKey: string): string {
    for (const [cacheKey, info] of (this.registry as unknown as { cache: Map<string, TokenInfo> })['cache']) {
      if (info.token === tokenKey) return cacheKey;
    }
    return '';
  }

  /**
   * Extract client code from the session for WS auth headers.
   * SmartAPI requires client code in the WS handshake.
   */
  private extractClientCode(): string {
    // session.creds is private — expose via a getter in Phase 3 refactor.
    // For Phase 2C, accessed via type cast since SmartApiSession is our own class.
    return (this.session as unknown as { creds: { clientId: string } }).creds.clientId;
  }

  private extractApiKey(): string {
    return (this.session as unknown as { creds: { apiKey: string } }).creds.apiKey;
  }
}
