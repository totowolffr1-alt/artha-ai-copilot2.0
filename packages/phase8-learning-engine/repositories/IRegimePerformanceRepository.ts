/**
 * phase8/repositories/IRegimePerformanceRepository.ts
 * Source: phase8-contracts-v1.md §4.6
 */
import type { RegimePriorDTO } from '../dtos/outputs';

export interface IRegimePerformanceRepository {
  upsert(prior: RegimePriorDTO): Promise<void>;
  upsertBatch(priors: RegimePriorDTO[]): Promise<void>;
}
