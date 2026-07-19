/**
 * packages/phase7-broker/src/__tests__/AngelOneAdapter.test.ts
 * Artha AI — Phase 7 Angel One Adapter & Mappers Tests
 */

import { AngelOneOrderMapper } from '../adapters/AngelOneOrderMapper';
import { AngelOneFillMapper } from '../adapters/AngelOneFillMapper';
import { AngelOneBrokerAdapter } from '../adapters/AngelOneBrokerAdapter';
import { OrderRequest } from '../types/domain';

describe('AngelOneOrderMapper', () => {
  test('maps a standard LIMIT buy order correctly', () => {
    const request: OrderRequest = {
      order_request_id: 'attempt-123',
      intent_id: 'intent-456',
      idempotency_key: 'idem-789',
      symbol_id: 'RELIANCE',
      broker_direction: 'BUY',
      order_type: 'LIMIT',
      qty: 10,
      price: 2850.50,
      trigger_price: null,
      product_type: 'CNC',
      validity: 'DAY',
      created_at: new Date(),
      attempt: 1
    };

    const payload = AngelOneOrderMapper.mapToAngelOne(request, '2885');
    expect(payload.variety).toBe('NORMAL');
    expect(payload.symboltoken).toBe('2885');
    expect(payload.tradingsymbol).toBe('RELIANCE-EQ');
    expect(payload.ordertype).toBe('LIMIT');
    expect(payload.producttype).toBe('DELIVERY');
    expect(payload.price).toBe('2850.50');
    expect(payload.quantity).toBe('10');
  });

  test('maps a STOPLOSS sell order variety correctly', () => {
    const request: OrderRequest = {
      order_request_id: 'attempt-999',
      intent_id: 'intent-456',
      idempotency_key: 'idem-789',
      symbol_id: 'TCS',
      broker_direction: 'SELL',
      order_type: 'SL',
      qty: 5,
      price: 3600.00,
      trigger_price: 3590.00,
      product_type: 'MIS',
      validity: 'DAY',
      created_at: new Date(),
      attempt: 1
    };

    const payload = AngelOneOrderMapper.mapToAngelOne(request, '11536');
    expect(payload.variety).toBe('STOPLOSS');
    expect(payload.symboltoken).toBe('11536');
    expect(payload.ordertype).toBe('STOPLOSS_LIMIT');
    expect(payload.producttype).toBe('INTRADAY');
    expect(payload.triggerprice).toBe('3590.00');
  });
});

describe('AngelOneFillMapper', () => {
  test('calculates correct slippage basis points and direction', () => {
    const rawOrder = {
      orderid: 'brk-100',
      averageprice: '101.50',
      filledshares: '20',
      status: 'complete',
      transactiontype: 'BUY',
      updatetime: '2026-07-19 12:00:00'
    };

    // Expected: 100.00, Actual: 101.50
    // Slippage = +1.50, which is ADVERSE for a BUY order
    // 1.50 / 100.00 = 0.015 = 150 basis points
    const fill = AngelOneFillMapper.mapToFill('req-123', rawOrder, 100.00);
    
    expect(fill.fill_qty).toBe(20);
    expect(fill.fill_price).toBe(101.50);
    expect(fill.slippage.slippage_abs).toBe(1.50);
    expect(fill.slippage.slippage_bps).toBe(150);
    expect(fill.slippage.direction).toBe('ADVERSE');
  });
});

describe('AngelOneBrokerAdapter', () => {
  test('falls back to successful mock response when client credentials are placeholder values', async () => {
    const adapter = new AngelOneBrokerAdapter('your_client_id', 'client_secret', 'pwd', 'totp_secret');
    const request: OrderRequest = {
      order_request_id: 'attempt-123',
      intent_id: 'intent-456',
      idempotency_key: 'idem-789',
      symbol_id: 'RELIANCE',
      broker_direction: 'BUY',
      order_type: 'MARKET',
      qty: 10,
      price: null,
      trigger_price: null,
      product_type: 'MIS',
      validity: 'DAY',
      created_at: new Date(),
      attempt: 1
    };

    const res = await adapter.placeOrder(request);
    expect(res.raw_status).toBe('SUCCESS');
    expect(res.normalized_status).toBe('OPEN');
    expect(res.broker_order_id).not.toBeNull();
  });
});
