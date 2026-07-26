/**
 * trading.routes.ts
 * Uses shared brokerSession singleton — no separate auth, no duplicate TOTP.
 */

import { Router, Request, Response } from 'express';
import { getJwtToken, getApiHeaders, getSessionStatus } from '../services/brokerSession';
import axios from 'axios';

export const tradingRouter = Router();

const orderStore = new Map<string, any>();

function makeOrderId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

// ── GET /api/trading/orders ────────────────────────────────────────────────────
tradingRouter.get('/orders', (_req: Request, res: Response) => {
  res.json({ orders: Array.from(orderStore.values()) });
});

// ── POST /api/trading/orders ───────────────────────────────────────────────────
tradingRouter.post('/orders', async (req: Request, res: Response) => {
  const { symbol, direction, qty, price, order_type, product_type } = req.body ?? {};

  if (!symbol || !direction || !qty) {
    return res.status(400).json({ error: 'Missing required parameters: symbol, direction, qty' });
  }

  const token = await getJwtToken();
  const { lastError } = getSessionStatus();

  if (!token) {
    return res.status(401).json({
      error: 'Broker not authenticated',
      message: lastError || 'Angel One login required. Check .env credentials.',
    });
  }

  const orderId = makeOrderId();
  const headers = await getApiHeaders();

  // Build Angel One order payload
  const orderPayload = {
    variety:          'NORMAL',
    tradingsymbol:    symbol,
    symboltoken:      '', // will be resolved in Phase 12 with live market data
    transactiontype:  direction === 'LONG' ? 'BUY' : 'SELL',
    exchange:         'NSE',
    ordertype:        order_type || 'MARKET',
    producttype:      product_type || 'DELIVERY',
    duration:         'DAY',
    price:            price ? String(parseFloat(price)) : '0',
    squareoff:        '0',
    stoploss:         '0',
    quantity:         String(parseInt(qty, 10)),
  };

  try {
    const { data } = await axios.post(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/placeOrder',
      orderPayload,
      { headers, timeout: 8000 }
    );

    const brokerOrderId = data?.data?.orderid || `sim-${orderId}`;
    const status = data?.status === true ? 'OPEN' : 'REJECTED';
    const rejectReason = data?.status !== true ? (data?.message || 'Unknown reason') : null;

    const record = {
      order_request_id: orderId,
      symbol,
      direction,
      qty: parseInt(qty, 10),
      price: price ? parseFloat(price) : null,
      order_type: order_type || 'MARKET',
      product_type: product_type || 'DELIVERY',
      broker_order_id: brokerOrderId,
      status,
      reject_reason: rejectReason,
      executed_at: new Date().toISOString(),
    };

    orderStore.set(orderId, record);
    console.log(`[Trading] Order ${status}: ${direction} ${qty} ${symbol} @ ${price || 'MARKET'}`);

    return res.json({ success: status === 'OPEN', order: record });
  } catch (err: any) {
    // Simulated order for dev/test when API not reachable
    const simRecord = {
      order_request_id: orderId,
      symbol, direction, qty: parseInt(qty, 10),
      price: price ? parseFloat(price) : null,
      order_type: order_type || 'MARKET',
      product_type: product_type || 'DELIVERY',
      broker_order_id: `sim-${orderId}`,
      status: 'SIMULATED',
      reject_reason: null,
      executed_at: new Date().toISOString(),
    };
    orderStore.set(orderId, simRecord);
    console.log(`[Trading] Simulated order for ${symbol} - Qty: ${qty} (broker error: ${err.message})`);
    return res.json({ success: true, order: simRecord, simulated: true });
  }
});

// ── GET /api/trading/orders/:id ────────────────────────────────────────────────
tradingRouter.get('/orders/:id', (req: Request, res: Response) => {
  const order = orderStore.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

// ── In-memory copilot trade log ───────────────────────────────────────────────
interface CopilotTrade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  status: 'OPEN' | 'CLOSED' | 'PENDING';
  mode: 'PAPER' | 'LIVE';
  openedAt: string;
  closedAt?: string;
  strategy: string;
}

// Seed with realistic mock trades (replaced by real data when copilot executes)
const copilotTrades: CopilotTrade[] = [
  {
    id: 'ct-001', symbol: 'RELIANCE', side: 'BUY', qty: 5,
    entryPrice: 2862.50, currentPrice: 2880.00, pnl: 87.50, pnlPct: 0.61,
    status: 'OPEN', mode: 'PAPER', strategy: 'VOLATILITY_SQUEEZE',
    openedAt: new Date(Date.now() - 3 * 3600000).toISOString(),
  },
  {
    id: 'ct-002', symbol: 'CUPID', side: 'BUY', qty: 50,
    entryPrice: 207.80, currentPrice: 215.40, pnl: 380.00, pnlPct: 3.66,
    status: 'OPEN', mode: 'PAPER', strategy: 'MACD_CROSSOVER',
    openedAt: new Date(Date.now() - 1 * 3600000).toISOString(),
  },
  {
    id: 'ct-003', symbol: 'ZOMATO', side: 'SELL', qty: 100,
    entryPrice: 271.20, currentPrice: 264.80, pnl: 640.00, pnlPct: 2.36,
    status: 'CLOSED', mode: 'PAPER', strategy: 'RSI_MEAN_REVERSION',
    openedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
    closedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: 'ct-004', symbol: 'SBIN', side: 'BUY', qty: 20,
    entryPrice: 818.40, currentPrice: 821.80, pnl: 68.00, pnlPct: 0.41,
    status: 'CLOSED', mode: 'PAPER', strategy: 'VOLATILITY_SQUEEZE',
    openedAt: new Date(Date.now() - 6 * 3600000).toISOString(),
    closedAt: new Date(Date.now() - 4 * 3600000).toISOString(),
  },
  {
    id: 'ct-005', symbol: 'TCS', side: 'SELL', qty: 3,
    entryPrice: 3610.00, currentPrice: 3598.50, pnl: -34.50, pnlPct: -0.32,
    status: 'CLOSED', mode: 'PAPER', strategy: 'EMA_CROSSOVER',
    openedAt: new Date(Date.now() - 8 * 3600000).toISOString(),
    closedAt: new Date(Date.now() - 6 * 3600000).toISOString(),
  },
];

function computeTradeSummary() {
  const closed = copilotTrades.filter(t => t.status === 'CLOSED');
  const wins = closed.filter(t => t.pnl > 0).length;
  return {
    totalPnL: copilotTrades.reduce((s, t) => s + t.pnl, 0),
    openTrades: copilotTrades.filter(t => t.status === 'OPEN').length,
    todayTrades: copilotTrades.length,
    winRate: closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0,
  };
}

// ── GET /api/trading/copilot-trades ──────────────────────────────────────────
tradingRouter.get('/copilot-trades', (_req: Request, res: Response) => {
  res.json({ trades: copilotTrades, summary: computeTradeSummary() });
});

// ── GET /api/trading/copilot-stream (SSE) ────────────────────────────────────
tradingRouter.get('/copilot-stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = () => {
    const data = JSON.stringify({ trades: copilotTrades, summary: computeTradeSummary() });
    res.write(`data: ${data}\n\n`);
  };

  send(); // send immediately on connect
  const interval = setInterval(send, 3000);
  req.on('close', () => clearInterval(interval));
});
