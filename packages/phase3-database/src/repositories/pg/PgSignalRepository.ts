/**
 * packages/phase3-database/src/repositories/pg/PgSignalRepository.ts
 * Artha AI — Phase 3
 */

import type { Pool } from 'pg';
import type { ISignalRepository } from '../interfaces/ISignalRepository';
import type { SignalRow, SignalStatus, FeatureVector } from '../../types/domain';
import type { InsertSignal } from '../../types/insert-dtos';

function mapRow(r: Record<string, unknown>): SignalRow {
  return {
    signal_id:        r['signal_id'] as string,
    symbol_id:        r['symbol_id'] as string,
    strategy_run_id:  (r['strategy_run_id'] as string | null) ?? null,
    signal_type:      r['signal_type'] as string,
    direction:        r['direction'] as SignalRow['direction'],
    strength:         parseFloat(r['strength'] as string),
    entry_price_hint: r['entry_price_hint'] != null ? parseFloat(r['entry_price_hint'] as string) : null,
    stop_loss:        r['stop_loss'] != null ? parseFloat(r['stop_loss'] as string) : null,
    take_profit:      r['take_profit'] != null ? parseFloat(r['take_profit'] as string) : null,
    kelly_fraction:   r['kelly_fraction'] != null ? parseFloat(r['kelly_fraction'] as string) : null,
    regime:           (r['regime'] as string | null) ?? null,
    features:         (r['features'] as FeatureVector) ?? {},
    status:           r['status'] as SignalStatus,
    fired_at:         new Date(r['fired_at'] as string),
    expires_at:       r['expires_at'] != null ? new Date(r['expires_at'] as string) : null,
    acted_at:         r['acted_at'] != null ? new Date(r['acted_at'] as string) : null,
    acted_by_trade:   (r['acted_by_trade'] as string | null) ?? null,
  };
}

export class PgSignalRepository implements ISignalRepository {
  constructor(private readonly pool: Pool) {}

  async insert(signal: InsertSignal): Promise<SignalRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO signals (
         symbol_id, strategy_run_id, signal_type, direction, strength,
         entry_price_hint, stop_loss, take_profit, kelly_fraction,
         regime, features, status, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::signal_st, $13)
       RETURNING *`,
      [
        signal.symbol_id, signal.strategy_run_id ?? null,
        signal.signal_type, signal.direction, signal.strength,
        signal.entry_price_hint ?? null, signal.stop_loss ?? null,
        signal.take_profit ?? null, signal.kelly_fraction ?? null,
        signal.regime ?? null, JSON.stringify(signal.features ?? {}),
        signal.status ?? 'pending', signal.expires_at ?? null,
      ],
    );
    return mapRow(rows[0]);
  }

  async findById(signalId: string): Promise<SignalRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM signals WHERE signal_id = $1`, [signalId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findPending(symbolId?: string): Promise<SignalRow[]> {
    const params: unknown[] = [];
    let sql = `SELECT * FROM signals WHERE status = 'pending'`;
    if (symbolId) { params.push(symbolId); sql += ` AND symbol_id = $${params.length}`; }
    sql += ` ORDER BY fired_at DESC`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(mapRow);
  }

  async markActed(signalId: string, tradeId: string): Promise<void> {
    await this.pool.query(
      `UPDATE signals SET status = 'acted', acted_at = now(), acted_by_trade = $1
       WHERE signal_id = $2`,
      [tradeId, signalId],
    );
  }

  async updateStatus(signalId: string, status: SignalStatus): Promise<void> {
    await this.pool.query(
      `UPDATE signals SET status = $1::signal_st WHERE signal_id = $2`,
      [status, signalId],
    );
  }

  async findByStrategyRun(strategyRunId: string, limit = 100): Promise<SignalRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM signals WHERE strategy_run_id = $1 ORDER BY fired_at DESC LIMIT $2`,
      [strategyRunId, limit],
    );
    return rows.map(mapRow);
  }
}
