/**
 * phase8/repositories/IIndicatorPerformanceRepository.ts
 * Source: phase8-contracts-v1.md §4.5
 */
import type { IndicatorPerformanceDTO } from '../dtos/outputs';

export interface IIndicatorPerformanceRepository {
  upsert(perf: IndicatorPerformanceDTO): Promise<void>;
  upsertBatch(perfs: IndicatorPerformanceDTO[]): Promise<void>;
  findRankedByRun(strategy_run_id: string): Promise<IndicatorPerformanceDTO[]>;
}
