/**
 * phase8/contracts/IIndicatorPerformanceCalculator.ts
 * Source: phase8-contracts-v1.md §3.9, phase8-indicator-performance-producer-v1.md
 */
import type { TrainingRunId } from '../domain/types';
import type { FeatureVectorDTO, LabelledOutcomeDTO } from '../dtos/inputs';
import type { IndicatorPerformanceDTO } from '../dtos/outputs';

export interface IIndicatorPerformanceCalculator {
  calculate(
    training_run_id: TrainingRunId,
    strategy_run_id: string,
    corpus: LabelledOutcomeDTO[],
    vectors: FeatureVectorDTO[]
  ): Promise<IndicatorPerformanceDTO[]>;
}
