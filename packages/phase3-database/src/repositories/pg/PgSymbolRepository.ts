/**
 * packages/phase3-database/src/repositories/pg/PgSymbolRepository.ts
 * Artha AI — Phase 3
 *
 * PostgreSQL implementation of ISymbolRepository.
 * All numeric columns are parsed from pg's string output via parseFloat.
 * All queries use parameterized values — zero string interpolation.
 */

import type { Pool, PoolClient } from 'pg';
import type { ISymbolRepository } from '../interfaces/ISymbolRepository';
import type { SymbolRow } from '../../types/domain';
import type { InsertSymbol } from '../../types/insert-dtos';

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapRow(r: Record<string, unknown>): SymbolRow {
  return {
    symbol_id:        r['symbol_id'] as string,
    ticker:           r['ticker'] as string,
    name:             (r['name'] as string | null) ?? null,
    exchange:         r['exchange'] as SymbolRow['exchange'],
    asset_type:       r['asset_type'] as SymbolRow['asset_type'],
    lot_size:         parseFloat(r['lot_size'] as string),
    tick_size:        parseFloat(r['tick_size'] as string),
    isin:             (r['isin'] as string | null) ?? null,
    broker_token:     (r['broker_token'] as string | null) ?? null,
    broker_exch_type: r['broker_exch_type'] != null
      ? parseInt(r['broker_exch_type'] as string, 10) : null,
    is_active:        r['is_active'] as boolean,
    created_at:       new Date(r['created_at'] as string),
    updated_at:       new Date(r['updated_at'] as string),
  };
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class PgSymbolRepository implements ISymbolRepository {
  constructor(private readonly pool: Pool) {}

  async findByTicker(exchange: string, ticker: string): Promise<SymbolRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM symbols WHERE exchange = $1::exchange_t AND ticker = $2 AND is_active = true`,
      [exchange, ticker],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findByBrokerToken(brokerToken: string): Promise<SymbolRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM symbols WHERE broker_token = $1`,
      [brokerToken],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findById(symbolId: string): Promise<SymbolRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM symbols WHERE symbol_id = $1`,
      [symbolId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findActive(): Promise<SymbolRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM symbols WHERE is_active = true ORDER BY exchange, ticker`,
    );
    return rows.map(mapRow);
  }

  async upsertMany(symbols: InsertSymbol[]): Promise<{ upserted: number; deactivated: number }> {
    if (symbols.length === 0) return { upserted: 0, deactivated: 0 };

    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');

      let upserted = 0;
      // Chunk to avoid massive single query
      const CHUNK = 500;
      for (let i = 0; i < symbols.length; i += CHUNK) {
        const chunk = symbols.slice(i, i + CHUNK);
        for (const sym of chunk) {
          await client.query(
            `INSERT INTO symbols (
               ticker, name, exchange, asset_type,
               lot_size, tick_size, isin, broker_token, broker_exch_type, is_active
             ) VALUES ($1, $2, $3::exchange_t, $4::asset_type_t, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (exchange, ticker)
             DO UPDATE SET
               name             = EXCLUDED.name,
               lot_size         = EXCLUDED.lot_size,
               tick_size        = EXCLUDED.tick_size,
               isin             = EXCLUDED.isin,
               broker_token     = EXCLUDED.broker_token,
               broker_exch_type = EXCLUDED.broker_exch_type,
               is_active        = EXCLUDED.is_active,
               updated_at       = now()`,
            [
              sym.ticker,
              sym.name ?? null,
              sym.exchange,
              sym.asset_type,
              sym.lot_size ?? 1,
              sym.tick_size ?? 0.05,
              sym.isin ?? null,
              sym.broker_token ?? null,
              sym.broker_exch_type ?? null,
              sym.is_active ?? true,
            ],
          );
          upserted++;
        }
      }

      await client.query('COMMIT');
      return { upserted, deactivated: 0 };
    } catch (err) {
      if (client) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (client) client.release();
    }
  }

  async deactivateExcept(activeBrokerTokens: string[]): Promise<number> {
    if (activeBrokerTokens.length === 0) return 0;
    const { rowCount } = await this.pool.query(
      `UPDATE symbols
       SET is_active = false, updated_at = now()
       WHERE broker_token IS NOT NULL
         AND broker_token != ALL($1::varchar[])
         AND is_active = true`,
      [activeBrokerTokens],
    );
    return rowCount ?? 0;
  }
}
