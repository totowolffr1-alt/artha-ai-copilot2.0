import { PgSymbolRepository } from '../repositories/pg/PgSymbolRepository';
import { Pool } from 'pg';
import type { InsertSymbol } from '../types/insert-dtos';

jest.mock('pg');

describe('PgSymbolRepository Unit Tests', () => {
  let mockPool: jest.Mocked<Pool>;
  let repo: PgSymbolRepository;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
    } as unknown as jest.Mocked<Pool>;

    repo = new PgSymbolRepository(mockPool);
  });

  it('should find symbol by ticker', async () => {
    const mockRow = {
      symbol_id: 'd3b07384-d113-4956-a5db-876bb015e128',
      ticker: 'RELIANCE',
      name: 'Reliance Industries Ltd',
      exchange: 'NSE',
      asset_type: 'equity',
      lot_size: '1.00',
      tick_size: '0.0500',
      isin: 'INE002A01018',
      broker_token: '2885',
      broker_exch_type: '1',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    (mockPool.query as jest.Mock).mockResolvedValue({
      rows: [mockRow],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const result = await repo.findByTicker('NSE', 'RELIANCE');

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM symbols WHERE exchange = $1::exchange_t AND ticker = $2'),
      ['NSE', 'RELIANCE']
    );

    expect(result).not.toBeNull();
    expect(result!.ticker).toBe('RELIANCE');
    expect(result!.lot_size).toBe(1);
    expect(result!.tick_size).toBe(0.05);
  });

  it('should return null when symbol is not found', async () => {
    (mockPool.query as jest.Mock).mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const result = await repo.findByTicker('NSE', 'ABSENT');
    expect(result).toBeNull();
  });
});
