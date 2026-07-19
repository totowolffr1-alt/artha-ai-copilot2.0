/**
 * packages/phase3-database/src/repositories/pg/PgStrategyRunRepository.ts
 * Artha AI — Phase 3
 */

import type { Pool } from 'pg';
import type { IStrategyRunRepository, StrategyRunUpdateFields } from '../interfaces/IStrategyRunRepository';
import type { StrategyRunRow, ParameterSnapshot } from '../../types/domain';
import type { InsertStrategyRun } from '../../types/insert-dtos';

function mapRow(r: Record<string, unknown>): StrategyRunRow {
  return {
    strategy_run_id:    r['strategy_run_id'] as string,
    strategy_id:        r['strategy_id'] as string,
    strategy_version:   parseInt(r['strategy_version'] as string, 10),
    mode:               r['mode'] as StrategyRunRow['mode'],
    status:             r['status'] as StrategyRunRow['status'],
    parameter_snapshot: r['parameter_snapshot'] as ParameterSnapshot,
    summary_metrics:    (r['summary_metrics'] as Record<string, unknown> | null) ?? null,
    reports_jsonb:      (r['reports_jsonb'] as Record<string, unknown> | null) ?? null,
    walk_forward_fold:  r['walk_forward_fold'] != null ? parseInt(r['walk_forward_fold'] as string, 10) : null,
    started_at:         r['started_at'] != null ? new Date(r['started_at'] as string) : null,
    completed_at:       r['completed_at'] != null ? new Date(r['completed_at'] as string) : null,
    error_message:      (r['error_message'] as string | null) ?? null,
    created_at:         new Date(r['created_at'] as string),
  };
}

export class PgStrategyRunRepository implements IStrategyRunRepository {
  constructor(private readonly pool: Pool) {}

  async insert(run: InsertStrategyRun): Promise<StrategyRunRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO strategy_runs (
         strategy_id, strategy_version, mode, status,
         parameter_snapshot, walk_forward_fold
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        run.strategy_id, run.strategy_version ?? 1, run.mode,
        run.status ?? 'pending', JSON.stringify(run.parameter_snapshot),
        run.walk_forward_fold ?? null,
      ],
    );
    return mapRow(rows[0]);
  }

  async findById(strategyRunId: string): Promise<StrategyRunRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM strategy_runs WHERE strategy_run_id = $1`, [strategyRunId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findByStrategyId(strategyId: string, limit = 20): Promise<StrategyRunRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM strategy_runs WHERE strategy_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [strategyId, limit],
    );
    return rows.map(mapRow);
  }

  async findRunning(): Promise<StrategyRunRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM strategy_runs WHERE status IN ('pending', 'running') ORDER BY created_at`,
    );
    return rows.map(mapRow);
  }

  async update(strategyRunId: string, fields: StrategyRunUpdateFields): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const add = (col: string, val: unknown): void => {
      sets.push(`${col} = $${idx}`); values.push(val); idx++;
    };
    if (fields.status          !== undefined) add('status',          fields.status);
    if (fields.summary_metrics !== undefined) add('summary_metrics', JSON.stringify(fields.summary_metrics));
    if (fields.reports_jsonb   !== undefined) add('reports_jsonb',   JSON.stringify(fields.reports_jsonb));
    if (fields.started_at      !== undefined) add('started_at',      fields.started_at);
    if (fields.completed_at    !== undefined) add('completed_at',    fields.completed_at);
    if (fields.error_message   !== undefined) add('error_message',   fields.error_message);
    if (sets.length === 0) return;
    values.push(strategyRunId);
    await this.pool.query(
      `UPDATE strategy_runs SET ${sets.join(', ')} WHERE strategy_run_id = $${idx}`,
      values,
    );
  }
}
