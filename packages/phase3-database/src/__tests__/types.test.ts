import type {
  SymbolRow,
  TickRow,
  CandleRow,
  OrderRow,
  TradeRow,
  ExecutionRow,
} from '../types/domain';

describe('TypeScript Type Layout Compile Tests', () => {
  it('should compile type assertions correctly', () => {
    const symbol: Partial<SymbolRow> = {
      symbol_id: 'd3b07384-d113-4956-a5db-876bb015e128',
      ticker: 'RELIANCE',
      exchange: 'NSE',
      asset_type: 'equity',
      lot_size: 1,
      tick_size: 0.05,
    };

    expect(symbol.ticker).toBe('RELIANCE');
    expect(symbol.exchange).toBe('NSE');
    expect(symbol.asset_type).toBe('equity');
  });

  it('should support execution and order mappings', () => {
    const order: Partial<OrderRow> = {
      order_id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      status: 'complete',
      direction: 'BUY',
      qty: 10,
    };

    const exec: Partial<ExecutionRow> = {
      execution_id: 'e1e2e3e4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      fill_qty: 10,
      fill_price: 2450.50,
      commission: 20.00,
    };

    expect(order.status).toBe('complete');
    expect(exec.fill_qty).toBe(10);
    expect(exec.fill_price).toBe(2450.50);
  });
});
