/**
 * phase8/contracts/IFeaturePipeline.ts
 * Source: phase8-contracts-v1.md §3.2
 */
import type { FeatureVectorDTO, LearningRecordDTO } from '../dtos/inputs';

export interface IFeaturePipeline {
  extract(record: LearningRecordDTO): FeatureVectorDTO | null;
  extractBatch(records: LearningRecordDTO[]): (FeatureVectorDTO | null)[];
}
