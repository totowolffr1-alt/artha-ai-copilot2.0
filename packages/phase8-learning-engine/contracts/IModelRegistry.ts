/**
 * phase8/contracts/IModelRegistry.ts
 * Source: phase8-contracts-v1.md §3.5
 */
import type { ModelKey, ModelVersionId } from '../domain/types';
import type { ModelVersionDTO } from '../dtos/outputs';

export interface IModelRegistry {
  register(model: ModelVersionDTO): Promise<void>;
  activate(model_version_id: ModelVersionId): Promise<void>;
  getCurrent(model_key: ModelKey): Promise<ModelVersionDTO | null>;
  getHistory(model_key: ModelKey): Promise<ModelVersionDTO[]>;
  getAllCurrentForRun(strategy_run_id: string): Promise<ModelVersionDTO[]>;
}
