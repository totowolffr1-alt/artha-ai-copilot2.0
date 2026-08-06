/**
 * liveMarketService.ts — Manages live market tick connection and fallback polling
 *
 * Activates AngelOne WebSocket adapter when credentials exist, subscribing to
 * watchlist and holdings symbols.
 *
 * Implements:
 *  - Real-time tick aggregation into 1-minute OHLC bars
 *  - Relaying formed bars to the SignalEngine
 *  - Fallback to Yahoo Finance polling if WebSocket ticks drop for >45s during market hours
 *  - Auto-reconnect and health checks Integration
 */

import WebSocket from 'ws';
// Polyfill WebSocket globally for packages/phase2-market-data WebSocket client
(global as any).WebSocket = WebSocket;

import { SimpleEventBus } from '../../../../packages/phase2-market-data/src/marketData/SimpleEventBus';
import { AngelOneAdapter } from '../../../../packages/phase2-market-data/src/marketData/adapters/angelone/AngelOneAdapter';
import { MockMarketDataAdapter } from '../../../../packages/phase2-market-data/src/marketData/adapters/mock/MockAdapter';
import { getWatchlistSymbols } from '../routes/watchlist.routes';
import { getCachedHoldings, getJwtToken } from './brokerSession';
import { pushNotification } from './notificationService';
import { updateLastTick } from './healthMonitor';
import { SignalEngine } from '../../../../packages/phase5-strategy/src/signals/SignalEngine';
import { TradeJournalService } from './tradeJournalService';
import { executeSignal, onTradeExit } from './orderExecutionService';
import axios from 'axios';
import { toYahooTicker } from '../utils/yahooMapper';


// Singleton instance variables
let _adapter: any = null;
let _bus: SimpleEventBus | null = null;
let _signalEngine: SignalEngine | null = null;

// Bar aggregation state per symbol
const openTracker: Record<string, number> = {};
const highTracker: Record<string, number> = {};
const lowTracker: Record<string, number> = {};
const closeTracker: Record<string, number> = {};
const volumeTracker: Record<string, number> = {};
const lastTimestamp: Record<string, number> = {};

// Fallback state
let lastTickReceivedAt = Date.now();
let fallbackInterval: NodeJS.Timeout | null = null;
let isFallbackActive = false;

// List of all active signals generated in real-time
export const liveSignalsHistory: any[] = [];
export const sseClients = new Set<any>();

// ── IST Market Hours Helper ───────────────────────────────────────────────────
function isMarketOpen(): boolean {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  if (day === 0 || day === 6) return false;
  return mins >= 555 && mins < 930; // 09:15 - 15:30 IST
}

// ── Get All Active Symbols ─────────────────────────────────────────────────────
export function getActiveSymbols(): string[] {
  const wl = getWatchlistSymbols();
  const holdings = getCachedHoldings();
  const hs = holdings ? holdings.holdings.map((h: any) => h.symbol) : [];
  const merged = Array.from(new Set([...wl, ...hs, 'RELIANCE', 'TCS', 'INFY', 'HDFCBANK']));
  return merged.filter(sym => typeof sym === 'string' && sym.length > 0);
}

// ── Tick Processor ────────────────────────────────────────────────────────────
export function handleIncomingTick(symbol: string, price: number, volume: number) {
  lastTickReceivedAt = Date.now();
  updateLastTick();

  // 1. Tick SL/TP monitor for active trades in TradeJournal
  const openTrades = TradeJournalService.getJournal(100, 'OPEN');
  for (const trade of openTrades) {
    if (trade.symbol !== symbol) continue;
    if (trade.direction === 'LONG') {
      if (price >= trade.take_profit) {
        const closed = TradeJournalService.recordExit(trade.trade_id, trade.take_profit, 'TARGET_HIT');
        if (closed) onTradeExit(trade.trade_id, symbol, closed.net_pnl, 'TP');
        console.log(`[LiveMarket] 🎯 Take Profit Hit for ${symbol}: Closed at ₹${trade.take_profit}`);
      } else if (price <= trade.stop_loss) {
        const closed = TradeJournalService.recordExit(trade.trade_id, trade.stop_loss, 'STOP_HIT');
        if (closed) onTradeExit(trade.trade_id, symbol, closed.net_pnl, 'SL');
        console.log(`[LiveMarket] 🛑 Stop Loss Hit for ${symbol}: Closed at ₹${trade.stop_loss}`);
      }
    } else if (trade.direction === 'SHORT') {
      if (price <= trade.take_profit) {
        const closed = TradeJournalService.recordExit(trade.trade_id, trade.take_profit, 'TARGET_HIT');
        if (closed) onTradeExit(trade.trade_id, symbol, closed.net_pnl, 'TP');
        console.log(`[LiveMarket] 🎯 Take Profit Hit for ${symbol}: Closed at ₹${trade.take_profit}`);
      } else if (price >= trade.stop_loss) {
        const closed = TradeJournalService.recordExit(trade.trade_id, trade.stop_loss, 'STOP_HIT');
        if (closed) onTradeExit(trade.trade_id, symbol, closed.net_pnl, 'SL');
        console.log(`[LiveMarket] 🛑 Stop Loss Hit for ${symbol}: Closed at ₹${trade.stop_loss}`);
      }
    }
  }

  // Aggregate into OHLC bar
  if (!openTracker[symbol]) {
    openTracker[symbol] = price;
    volumeTracker[symbol] = 0;
  }
  highTracker[symbol] = Math.max(highTracker[symbol] || price, price);
  lowTracker[symbol] = Math.min(lowTracker[symbol] || price, price);
  closeTracker[symbol] = price;
  volumeTracker[symbol] += volume;

  // Align ticks to 1-minute boundaries
  const now = Date.now();
  const currentMinute = Math.floor(now / 60000) * 60000;

  if (!lastTimestamp[symbol]) {
    lastTimestamp[symbol] = currentMinute;
  } else if (currentMinute > lastTimestamp[symbol]) {
    // Bar has closed!
    const open = openTracker[symbol];
    const high = highTracker[symbol];
    const low = lowTracker[symbol];
    const close = closeTracker[symbol];
    const vol = volumeTracker[symbol];

    // Reset trackers
    openTracker[symbol] = price;
    highTracker[symbol] = price;
    lowTracker[symbol] = price;
    closeTracker[symbol] = price;
    volumeTracker[symbol] = 0;
    lastTimestamp[symbol] = currentMinute;

    if (_signalEngine) {
      const signal = _signalEngine.processBar(symbol, open, high, low, close, vol, new Date(currentMinute));
      if (signal) {
        liveSignalsHistory.push(signal);
        if (liveSignalsHistory.length > 100) liveSignalsHistory.shift();

        // Automatically execute trade via Order Execution Service (Risk Guardian + Vault)
        executeSignal(signal).catch(err => console.error('[LiveMarket] Order execution error:', err));

        // Dispatch to SSE clients
        sseClients.forEach(res => {
          res.write(`data: ${JSON.stringify(signal)}\n\n`);
        });

        console.log(`[LiveMarket] 🚀 Signal Generated & Journaled: ${symbol} ${signal.direction} @ ₹${signal.entry_price}`);
        pushNotification({
          component: 'signal_engine',
          severity: 'HIGH',
          title: `Trade Signal: ${symbol}`,
          message: `${signal.direction} entry at ₹${signal.entry_price} (SL: ₹${signal.stop_loss}, TP: ₹${signal.take_profit})`,
        });
      }
    }
  }
}

// ── Yahoo Finance Fallback Polling ─────────────────────────────────────────────
async function pollYahooFinancePrices() {

  const symbols = getActiveSymbols();
  console.log(`[LiveMarket Fallback] Polling Yahoo Finance for ${symbols.length} symbols...`);

  for (const symbol of symbols) {
    try {
      const ticker = toYahooTicker(symbol);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;

      const { data } = await axios.get(url, {
        params: { range: '1d', interval: '1m' },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 4000
      });

      const result = data?.chart?.result?.[0];
      const meta = result?.meta;
      const price = meta?.regularMarketPrice;
      const volume = meta?.regularMarketVolume || 0;

      if (price) {
        // Emit TICK_RECEIVED on event bus to update UI stream and latestTicks cache in real-time
        if (_bus) {
          _bus.emit({
            type: 'TICK_RECEIVED',
            tick: {
              symbol: symbol.toUpperCase(),
              exchange: 'NSE',
              price,
              volume: Math.floor(volume / 390),
              timestamp: Date.now()
            }
          });
        }
      }
    } catch (err: any) {
      console.warn(`[LiveMarket Fallback] Fetch failed for ${symbol}:`, err.message);
    }
  }
}

function startFallbackPolling() {
  if (isFallbackActive) return;
  isFallbackActive = true;
  console.warn('[LiveMarket] ⚠️ WebSocket tick stream inactive. Activating Yahoo Finance polling fallback.');
  pushNotification({
    component: 'market_data',
    severity: 'WARNING',
    title: 'WebSocket Disconnection Fallback',
    message: 'WebSocket stream stopped receiving ticks. Switched to Yahoo Finance polling fallback.',
    suggested_fix: 'Check Angel One SmartAPI status or api keys.'
  });

  pollYahooFinancePrices();
  fallbackInterval = setInterval(pollYahooFinancePrices, 5000); // Poll every 5s for near-live prices
}

function stopFallbackPolling() {
  if (!isFallbackActive) return;
  isFallbackActive = false;
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
    fallbackInterval = null;
  }
  console.log('[LiveMarket] WebSocket ticks resumed. Deactivated Yahoo Finance polling fallback.');
  pushNotification({
    component: 'market_data',
    severity: 'INFO',
    title: 'WebSocket Ticks Resumed',
    message: 'Live broker WebSocket ticks resumed. Yahoo Finance fallback stopped.',
  });
}

// ── Liveness Watchdog ─────────────────────────────────────────────────────────
function startWatchdog() {
  setInterval(() => {
    if (!isMarketOpen()) {
      if (isFallbackActive) stopFallbackPolling();
      return;
    }

    const idleTime = Date.now() - lastTickReceivedAt;
    if (idleTime > 45000) {
      // Ticks dropped for >45s during market hours
      startFallbackPolling();
    } else if (isFallbackActive && idleTime < 10000) {
      // WebSocket recovered
      stopFallbackPolling();
    }
  }, 10000);
}

// ── Initialize Service ────────────────────────────────────────────────────────
export async function initLiveMarketFeed(
  bus: SimpleEventBus,
  signalEngine: SignalEngine
): Promise<any> {
  _bus = bus;
  _signalEngine = signalEngine;

  const isDemo = process.env.DEMO_MODE === 'true';
  const apiKey = (process.env.SMARTAPI_API_KEY || '').trim();

  // Route incoming ticks from EventBus to the tick processor
  bus.on('TICK_RECEIVED', (event: any) => {
    const tick = event.tick;
    handleIncomingTick(tick.symbol, tick.price, tick.volume || 100);
  });

  if (isDemo || !apiKey || apiKey.includes('your_')) {
    console.log('[LiveMarket] Starting in MOCK mode (Demo Mode is ON or credentials missing).');
    _adapter = new MockMarketDataAdapter(bus);
    await _adapter.connect();
    return _adapter;
  }

  console.log('[LiveMarket] Starting in LIVE Angel One SmartAPI mode.');
  const clientId = (process.env.SMARTAPI_CLIENT_ID || '').trim();
  const mpin = (process.env.SMARTAPI_PASSWORD || process.env.SMARTAPI_PIN || '').trim();
  const totpSecret = (process.env.SMARTAPI_TOTP_SECRET || '').trim();

  const creds = {
    clientId,
    mpin,
    apiKey,
    getTOTP: () => {
      // SmartApiSession uses this. In our cached mode, getTOTP is a fallback.
      const { generateTOTP } = require('./brokerSession');
      return generateTOTP(totpSecret);
    }
  };

  _adapter = new AngelOneAdapter(creds, bus);
  const connectResult = await _adapter.connect();

  if (connectResult.ok) {
    console.log('[LiveMarket] ✅ Live WebSocket Adapter connected successfully.');

    // Dynamic subscription logic: subscribe to active symbols
    const symbols = getActiveSymbols();
    console.log(`[LiveMarket] Subscribing to tick stream for: ${symbols.join(', ')}`);
    for (const symbol of symbols) {
      try {
        const tokenResult = await _adapter.resolveToken(symbol, 'NSE');
        if (tokenResult.ok) {
          _adapter.subscribeRawTick(tokenResult.value, 'SNAP_QUOTE', () => {});
        }
      } catch (err: any) {
        console.warn(`[LiveMarket] Symbol subscription failed for ${symbol}:`, err.message);
      }
    }

    startWatchdog();
  } else {
    console.warn('[LiveMarket] ⚠️ Live WebSocket connection inactive (Off-market hours or stream offline):', connectResult.error?.message);
    console.log('[LiveMarket] Maintaining LIVE Angel One Adapter for REST/orders & starting real price polling fallback.');
    startFallbackPolling();
    startWatchdog();
  }

  return _adapter;
}
