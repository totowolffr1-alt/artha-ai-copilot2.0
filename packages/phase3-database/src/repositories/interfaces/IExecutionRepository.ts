/**
 * IExecutionRepository.ts — Artha AI Phase 3
 * Append-only fill record contract. No UPDATE/DELETE operations.
 */
import type { ExecutionRow } from '../../types/domain';
import type { InsertExecution } from '../../types/insert-dtos';

export interface IExecutionRepository {
  /**
   * Append a new fill record. Immutable after insert.
   * Returns the created row with generated execution_id and received_ts.
   */
  insert(execution: InsertExecution): Promise<ExecutionRow>;

  /** All fills for a trade — used to compute avg_entry_price. */
  findByTrade(tradeId: string): Promise<ExecutionRow[]>;

  /** All fills for a broker order. */
  findByOrder(orderId: string): Promise<ExecutionRow[]>;

  /**
   * Dedup guard check before inserting.
   * Returns true if a fill with this broker_fill_id already exists.
   */
  existsByBrokerFillId(brokerFillId: string): Promise<boolean>;
}
