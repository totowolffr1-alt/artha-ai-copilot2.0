import { PgTradeRepository } from '../repositories/pg/PgTradeRepository';
import { Pool } from 'pg';
import type { InsertTrade } from '../types/insert-dtos';

jest.mock('pg');

describe('PgTradeRepository Unit Tests', () => {
  let mockPool: jest.Mocked<Pool>;
  let repo: PgTradeRepository;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    } as unknown as jest.Mocked<Pool>;

    repo = new PgTradeRepository(mockPool);
  });

  it('should insert a new trade', async () => {
    const insertData: InsertTrade = {
      symbol_id: 'd3b07384-d113-4956-a5db-876bb015e128',
      account_id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      mode: 'live',
      direction: 'LONG',
      qty: 100,
      status: 'pending',
    };

    const mockRow = {
      trade_id: 't1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      signal_id: null,
      symbol_id: insertData.symbol_id,
      account_id: insertData.account_id,
      mode: 'live',
      direction: 'LONG',
      qty: '100.00',
      filled_qty: '0.00',
      avg_entry_price: null,
      avg_exit_price: null,
      realised_pnl: null,
      commission: '0.00',
      slippage: null,
      close_reason: null,
      status: 'pending',
      opened_at: null,
      closed_at: null,
      updated_at: new Date().toISOString(),
    };

    (mockPool.query as jest.Mock).mockResolvedValue({
      rows: [mockRow],
      rowCount: 1,
      command: 'INSERT',
      oid: 0,
      fields: [],
    });

    const result = await repo.insert(insertData);

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO trades ('),
      [null, insertData.symbol_id, insertData.account_id, 'live', 'LONG', 100, 'pending']
    );

    expect(result.trade_id).toBe('t1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d');
    expect(result.qty).toBe(100);
    expect(result.filled_qty).toBe(0);
  });

  it('should update trade status dynamically', async () => {
    (mockPool.query as jest.Mock).mockResolvedValue({
      rows: [],
      rowCount: 1,
      command: 'UPDATE',
      oid: 0,
      fields: [],
    });

    await repo.update('t1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', {
      status: 'open',
      filled_qty: 100,
      avg_entry_price: 2450.50,
      opened_at: new Date('2026-07-18T10:00:00Z'),
    });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE trades SET updated_at = now()'),
      ['open', 100, 2450.50, new Date('2026-07-18T10:00:00Z'), 't1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d']
    );
  });
});
