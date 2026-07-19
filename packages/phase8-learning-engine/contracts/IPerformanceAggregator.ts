/**
 * phase8/contracts/IPerformanceAggregator.ts
 * Source: phase8-contracts-v1.md §3.7
 */
import type { TrainingRunId } from '../domain/types';
import type { LabelledOutcomeDTO } from '../dtos/inputs';
import type { PerformanceSummaryDTO } from '../dtos/outputs';

export interface IPerformanceAggregator {
  aggregate(
    training_run_id: TrainingRunId,
    strategy_run_id: string,
    corpus: LabelledOutcomeDTO[],
    period_end: Date
  ): Promise<PerformanceSummaryDTO[]>;
}
