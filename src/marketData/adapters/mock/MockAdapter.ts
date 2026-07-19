/**
 * src/marketData/adapters/mock/MockAdapter.ts
 *
 * Local-dev / demo implementation of IMarketDataAdapter.
 * Generates synthetic ticks for a fixed watchlist so the API + frontend
 * can run end-to-end on localhost with no AngelOne credentials.
 *
 * Swap this for AngelOneAdapter once real SmartAPI credentials are available —
 * both implement the same IMarketDataAdapter contract, so MarketDataService
 * and everything upstream of it does not change.
 */

import type {
  IMarketDataAdapter,
  RawTick,
  RawCandle,
  RawSymbol,
  TokenInfo,
  SubscriptionMode,
  AdapterInterval,
} from '../IMarketDataAdapter';
import type { Result } from '../../../utils/errors';
import { ok } from '../../../utils/errors';
import type { IEventBus } from '../../EventBus';

const WATCHLIST = [
  { ticker: 'RELIANCE', exchange: 'NSE', token: '2885', basePrice: 2950 },
  { ticker: 'TCS',      exchange: 'NSE', token: '11536', basePrice: 3850 },
  { ticker: 'INFY',     exchange: 'NSE', token: '1594', basePrice: 1650 },
  { ticker: 'HDFCBANK', exchange: 'NSE', token: '1333', basePrice: 1720 },
  { ticker: 'NIFTY50',  exchange: 'NSE', token: '99926000', basePrice: 24500 },
];

interface ActiveSub {
  callbacks: Set<(raw: RawTick) => void>;
}

export class MockMarketDataAdapter implements IMarketDataAdapter {
  readonly name = 'Mock';
  readonly isLive = false;

  private connected = false;
  private timer: NodeJS.Timeout | null = null;
  private subscriptions = new Map<string, ActiveSub>();
  private lastPrice = new Map<string, number>();

  constructor(private readonly bus: IEventBus) {
    for (const s of WATCHLIST) this.lastPrice.set(s.token, s.basePrice);
  }

  async connect(): Promise<Result<void>> {
    this.connected = true;
    this.timer = setInterval(() => this.tick(), 1000);
    return ok(undefined);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.subscriptions.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async resolveToken(ticker: string, exchange: string): Promise<Result<TokenInfo>> {
    const found = WATCHLIST.find(s => s.ticker === ticker && s.exchange === exchange);
    return ok({
      token: found?.token ?? '0',
      exchange: exchange as TokenInfo['exchange'],
      exchangeType: 1,
    } as TokenInfo);
  }

  subscribeRawTick(
    token: TokenInfo,
    _mode: SubscriptionMode,
    callback: (raw: RawTick) => void,
  ): () => void {
    const key = token.token;
    const existing = this.subscriptions.get(key);
    if (existing) {
      existing.callbacks.add(callback);
    } else {
      this.subscriptions.set(key, { callbacks: new Set([callback]) });
    }
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const sub = this.subscriptions.get(key);
      sub?.callbacks.delete(callback);
      if (sub && sub.callbacks.size === 0) this.subscriptions.delete(key);
    };
  }

  async fetchRawCandles(
    token: TokenInfo,
    _interval: AdapterInterval,
    _from: string,
    _to: string,
  ): Promise<Result<RawCandle[]>> {
    const base = this.lastPrice.get(token.token) ?? 1000;
    const candles: RawCandle[] = Array.from({ length: 50 }, (_, i) => {
      const drift = (Math.random() - 0.5) * base * 0.01;
      const o = base + drift * i * 0.1;
      const c = o + (Math.random() - 0.5) * base * 0.005;
      const h = Math.max(o, c) + Math.random() * base * 0.002;
      const l = Math.min(o, c) - Math.random() * base * 0.002;
      return {
        timestamp: new Date(Date.now() - (50 - i) * 60_000).toISOString(),
        open: o, high: h, low: l, close: c,
        volume: Math.floor(Math.random() * 100_000),
      };
    });
    return ok(candles);
  }

  async searchRawSymbols(query: string): Promise<Result<RawSymbol[]>> {
    const results = WATCHLIST
      .filter(s => s.ticker.toLowerCase().includes(query.toLowerCase()))
      .map(s => ({
        ticker: s.ticker,
        exchange: s.exchange,
        token: s.token,
        name: s.ticker,
      } as unknown as RawSymbol));
    return ok(results);
  }

  // ─── internal tick generator ──────────────────────────────────────────────

  private tick(): void {
    for (const s of WATCHLIST) {
      const sub = this.subscriptions.get(s.token);
      const prev = this.lastPrice.get(s.token) ?? s.basePrice;
      const changePct = (Math.random() - 0.5) * 0.004; // +/-0.2% per tick
      const price = Math.max(1, prev * (1 + changePct));
      this.lastPrice.set(s.token, price);

      const raw = {
        token: s.token,
        ltp: Math.round(price * 100), // paise, matching broker convention
        timestamp: Date.now(),
        volume: Math.floor(Math.random() * 1000),
      } as unknown as RawTick;

      this.bus.emit({
        type: 'TICK_RECEIVED',
        tick: {
          symbol: s.ticker,
          exchange: s.exchange,
          price,
          timestamp: new Date().toISOString(),
        },
      } as never);

      if (sub) for (const cb of sub.callbacks) cb(raw);
    }
  }
}
