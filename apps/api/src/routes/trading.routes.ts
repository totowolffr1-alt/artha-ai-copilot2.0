import { Router, Request, Response } from 'express';
import { AngelOneBrokerAdapter } from '../../../../packages/phase7-broker/src/adapters/AngelOneBrokerAdapter';
import { OrderRequest } from '../../../../packages/phase7-broker/src/types/domain';

export const tradingRouter = Router();

// Read credentials from environment variables (or use stubs)
const client_id = process.env.SMARTAPI_CLIENT_ID || 'your_client_id';
const client_secret = process.env.SMARTAPI_API_KEY || 'client_secret';
const password = process.env.SMARTAPI_PASSWORD || 'pwd';
const totp_secret = process.env.SMARTAPI_TOTP_SECRET || 'totp_secret';

const adapter = new AngelOneBrokerAdapter(client_id, client_secret, password, totp_secret);
const orderStore = new Map<string, any>();

tradingRouter.get('/orders', (_req: Request, res: Response) => {
  res.json({
    orders: Array.from(orderStore.values())
  });
});

tradingRouter.post('/orders', async (req: Request, res: Response) => {
  const { symbol, direction, qty, price, order_type } = req.body ?? {};

  if (!symbol || !direction || !qty) {
    return res.status(400).json({ error: 'Missing required parameters: symbol, direction, qty' });
  }

  const orderReq: OrderRequest = {
    order_request_id: `req-${Math.random().toString(36).substring(2, 11)}`,
    intent_id: `int-${Math.random().toString(36).substring(2, 11)}`,
    idempotency_key: `idem-${Math.random().toString(36).substring(2, 11)}`,
    symbol_id: symbol,
    broker_direction: direction,
    order_type: order_type || 'MARKET',
    qty: parseInt(qty, 10),
    price: price ? parseFloat(price) : null,
    trigger_price: null,
    product_type: 'MIS',
    validity: 'DAY',
    created_at: new Date(),
    attempt: 1
  };

  try {
    const result = await adapter.placeOrder(orderReq);
    
    const record = {
      ...orderReq,
      broker_order_id: result.broker_order_id,
      status: result.normalized_status,
      reject_reason: result.reject_reason,
      executed_at: result.received_at
    };

    orderStore.set(orderReq.order_request_id, record);

    res.json({
      success: result.normalized_status === 'OPEN',
      order: record
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
