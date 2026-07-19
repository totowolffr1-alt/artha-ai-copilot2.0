/**
 * phase8/repositories/ITrainingRunRepository.ts
 * Source: phase8-contracts-v1.md §4.1
 */
import type { TrainingRunId, TrainingRunStatus } from '../domain/types';
import type { TrainingRunDTO } from '../dtos/outputs';

export interface ITrainingRunRepository {
  save(run: TrainingRunDTO): Promise<void>;

  updateStatus(
    training_run_id: TrainingRunId,
    status: TrainingRunStatus,
    extra?: Partial<Pick<TrainingRunDTO, 'completed_at' | 'failure_reason' | 'model_version_id'>>
  ): Promise<void>;

  findById(training_run_id: TrainingRunId): Promise<TrainingRunDTO | null>;
  findLatestCompleted(strategy_run_id: string): Promise<TrainingRunDTO | null>;
  findInProgress(strategy_run_id: string): Promise<TrainingRunDTO | null>;
}
