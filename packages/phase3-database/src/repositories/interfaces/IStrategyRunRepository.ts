/**
 * IStrategyRunRepository.ts — Artha AI Phase 3
 * Strategy run lifecycle contract. Used by BacktestRunner (Phase 4).
 */
import type { StrategyRunRow, StrategyRunStatus } from '../../types/domain';
import type { InsertStrategyRun } from '../../types/insert-dtos';

export interface StrategyRunUpdateFields {
  status?:          StrategyRunStatus;
  summary_metrics?: Record<string, unknown>;
  reports_jsonb?:   Record<string, unknown>;
  started_at?:      Date;
  completed_at?:    Date;
  error_message?:   string;
}

export interface IStrategyRunRepository {
  insert(run: InsertStrategyRun): Promise<StrategyRunRow>;

  findById(strategyRunId: string): Promise<StrategyRunRow | null>;

  findByStrategyId(strategyId: string, limit?: number): Promise<StrategyRunRow[]>;

  /** Currently running strategies — used by process manager to detect orphans. */
  findRunning(): Promise<StrategyRunRow[]>;

  update(strategyRunId: string, fields: StrategyRunUpdateFields): Promise<void>;
}
