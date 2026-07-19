/**
 * phase8/contracts/IRegimePriorUpdater.ts
 * Source: phase8-contracts-v1.md §3.6
 */
import type { TrainingRunId } from '../domain/types';
import type { LabelledOutcomeDTO } from '../dtos/inputs';
import type { IndicatorPerformanceDTO, RegimePriorDTO } from '../dtos/outputs';

export interface IRegimePriorUpdater {
  compute(
    training_run_id: TrainingRunId,
    corpus: LabelledOutcomeDTO[],
    indicator_perfs: IndicatorPerformanceDTO[]
  ): Promise<RegimePriorDTO[]>;

  activate(regime_prior: RegimePriorDTO): Promise<void>;
}
