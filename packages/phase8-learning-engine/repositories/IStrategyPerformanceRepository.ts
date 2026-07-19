/**
 * phase8/repositories/IStrategyPerformanceRepository.ts
 * Source: phase8-contracts-v1.md §4.4
 */
import type { PerformanceSummaryDTO } from '../dtos/outputs';

export interface IStrategyPerformanceRepository {
  upsert(summary: PerformanceSummaryDTO): Promise<void>;
  upsertBatch(summaries: PerformanceSummaryDTO[]): Promise<void>;
}
