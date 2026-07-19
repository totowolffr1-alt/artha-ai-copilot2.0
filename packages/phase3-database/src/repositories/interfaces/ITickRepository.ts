/**
 * ITickRepository.ts — Artha AI Phase 3
 * High-throughput tick ingestion contract.
 * Implementations must use COPY protocol for batch inserts.
 */
import type { TickRow } from '../../types/domain';
import type { InsertTick } from '../../types/insert-dtos';

export interface ITickRepository {
  /**
   * Batch insert ticks via COPY protocol.
   * Target: ~50K rows/s. Adapter batches in 100ms windows before calling this.
   * Connection must use synchronous_commit = off.
   */
  insertBatch(ticks: InsertTick[]): Promise<void>;

  /** Range scan for CandleAggregator replay. */
  findRange(symbolId: string, from: Date, to: Date): Promise<TickRow[]>;

  /** Latest N ticks for a symbol. Used for last-price checks. */
  findLatest(symbolId: string, limit: number): Promise<TickRow[]>;
}
