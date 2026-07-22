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
