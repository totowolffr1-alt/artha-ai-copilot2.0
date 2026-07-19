/**
 * phase8/repositories/IModelVersionRepository.ts
 * Source: phase8-contracts-v1.md §4.2
 */
import type { ModelKey, ModelVersionId, ModelVersionStatus, TrainingRunId } from '../domain/types';
import type { ModelVersionDTO } from '../dtos/outputs';

export interface IModelVersionRepository {
  save(model: ModelVersionDTO): Promise<void>;

  updateStatus(
    model_version_id: ModelVersionId,
    status: ModelVersionStatus,
    extra?: Partial<Pick<ModelVersionDTO, 'activated_at' | 'superseded_at'>>
  ): Promise<void>;

  findById(model_version_id: ModelVersionId): Promise<ModelVersionDTO | null>;
  findCurrent(model_key: ModelKey): Promise<ModelVersionDTO | null>;
  findAllForRun(training_run_id: TrainingRunId): Promise<ModelVersionDTO[]>;
  findAllCurrentForStrategyRun(strategy_run_id: string): Promise<ModelVersionDTO[]>;

  /** Used by services/ModelRegistry.ts getHistory() — all versions for a ModelKey, trained_at DESC. */
  findHistoryByModelKey(model_key: ModelKey): Promise<ModelVersionDTO[]>;
}
