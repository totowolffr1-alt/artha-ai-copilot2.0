/**
 * phase8/contracts/IModelTrainer.ts
 * Source: phase8-contracts-v1.md §3.4
 */
import type { ModelKey } from '../domain/types';
import type { LabelledOutcomeDTO } from '../dtos/inputs';
import type { ModelVersionDTO } from '../dtos/outputs';

export interface IModelTrainer {
  train(model_key: ModelKey, corpus: LabelledOutcomeDTO[]): Promise<ModelVersionDTO | null>;
  trainAll(corpus: LabelledOutcomeDTO[]): Promise<Map<string, ModelVersionDTO>>;
}
