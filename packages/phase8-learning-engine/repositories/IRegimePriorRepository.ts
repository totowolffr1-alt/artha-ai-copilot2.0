/**
 * phase8/repositories/IRegimePriorRepository.ts
 * Source: phase8-contracts-v1.md §4.3
 */
import type { RegimePriorId, RegimePriorStatus, TrainingRunId } from '../domain/types';
import type { RegimePriorDTO } from '../dtos/outputs';

export interface IRegimePriorRepository {
  save(prior: RegimePriorDTO): Promise<void>;

  updateStatus(
    regime_prior_id: RegimePriorId,
    status: RegimePriorStatus,
    extra?: Partial<Pick<RegimePriorDTO, 'superseded_at'>>
  ): Promise<void>;

  findCurrent(
    regime_label: string,
    symbol_id: string | null,
    timeframe: string
  ): Promise<RegimePriorDTO | null>;

  findAllCurrentForRun(training_run_id: TrainingRunId): Promise<RegimePriorDTO[]>;
}
