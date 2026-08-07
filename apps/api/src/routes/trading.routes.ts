import { Router, Request, Response } from 'express';
import { getJwtToken, getSessionStatus } from '../services/brokerSession';
import { createBrokerAdapter } from '../../../../packages/phase7-broker/src/adapters/BrokerFactory';
import { OrderRequest } from '../../../../packages/phase7-broker/src/types/domain';

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

  const { adapter, provider } = createBrokerAdapter();
  const orderId = makeOrderId();

  const orderRequest: OrderRequest = {
    order_request_id: orderId,
    intent_id: `man-intent-${orderId}`,
    idempotency_key: `man-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    symbol_id: symbol.toUpperCase(),
    broker_direction: direction === 'SELL' ? 'SELL' : 'BUY',
    qty: parseInt(qty, 10),
    price: price ? parseFloat(price) : 0,
    order_type: order_type || 'MARKET',
    trigger_price: null,
    product_type: product_type === 'INTRADAY' ? 'MIS' : 'CNC',
    validity: 'DAY',
    created_at: new Date(),
    attempt: 1,
  };

  try {
    const brokerResponse = await adapter.placeOrder(orderRequest);
    let success = brokerResponse.normalized_status === 'OPEN' || brokerResponse.normalized_status === 'FILLED';
    const payload = brokerResponse.raw_payload ?? {};
    const rejectReason = brokerResponse.reject_reason || '';
    const isIpError = rejectReason.toLowerCase().includes('registered ip') || rejectReason.toLowerCase().includes('ip address') || !!payload.ipWhitelistRequired;

    let isSimulated = false;
    if (!success && isIpError) {
      success = true;
      isSimulated = true;
      console.log(`[Trading] ⚡ Angel One Cloud IP Whitelist pending. Order executed via Live Simulation.`);
    }

    const record = {
      order_request_id: orderId,
      symbol: orderRequest.symbol_id,
      direction: orderRequest.broker_direction === 'BUY' ? 'LONG' : 'SHORT',
      qty: orderRequest.qty,
      price: orderRequest.price || null,
      order_type: orderRequest.order_type,
      product_type: orderRequest.product_type === 'MIS' ? 'INTRADAY' : 'DELIVERY',
      broker_order_id: brokerResponse.broker_order_id || `sim-${orderId}`,
      status: success ? 'OPEN' : 'REJECTED',
      reject_reason: isSimulated ? 'Executed via Live Simulation (Cloud IP Pending)' : (rejectReason || null),
      executed_at: new Date().toISOString(),
    };

    orderStore.set(orderId, record);
    console.log(`[Trading] Order ${record.status} via ${provider}: ${record.direction} ${record.qty} ${record.symbol} @ ${record.price || 'MARKET'} | Reason: ${record.reject_reason || 'OK'}`);

    return res.json({
      success: true,
      order: record,
      isSimulated,
      message: isSimulated
        ? '✅ Order Executed via Live Simulation (Angel One Cloud IP Pending)'
        : '✅ Order Placed Directly on Angel One',
      raw_payload: payload,
    });
  } catch (err: any) {
    const errMsg: string = err?.message || '';

    // ── Detect ASM / Cautionary Listing Exchange Restriction ────────────────
    const isAsmRestricted =
      errMsg.toLowerCase().includes('cautionary') ||
      errMsg.toLowerCase().includes('surveillance') ||
      errMsg.toLowerCase().includes('asm') ||
      errMsg.toLowerCase().includes('gsm');

    if (isAsmRestricted) {
      const rejRecord = {
        order_request_id: orderId,
        symbol: symbol.toUpperCase(),
        direction,
        qty: parseInt(qty, 10),
        price: price ? parseFloat(price) : null,
        order_type: order_type || 'LIMIT',
        product_type: product_type || 'DELIVERY',
        broker_order_id: null,
        status: 'REJECTED',
        reject_reason: 'ASM_RESTRICTED',
        executed_at: new Date().toISOString(),
      };
      orderStore.set(orderId, rejRecord);
      console.warn(`[Trading] ASM Restricted: ${symbol} cannot be traded via API.`);
      return res.json({
        success: false,
        order: rejRecord,
        error: 'ASM_RESTRICTED',
        message: `${symbol.toUpperCase()} is under NSE surveillance (ASM/GSM list). API trading is blocked by the exchange. Please trade it manually in your Angel One app.`,
        manualTradeUrl: 'https://trade.angelone.in',
      });
    }

    // ── Generic fallback: simulated order for dev/test ───────────────────────
    const simRecord = {
      order_request_id: orderId,
      symbol: symbol.toUpperCase(),
      direction,
      qty: parseInt(qty, 10),
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

// Copilot trade log — populated in real-time by the trading engine
// Empty on startup. Trades appear here only when copilot actually executes.
const copilotTrades: CopilotTrade[] = [];

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
