/**
 * phase8/contracts/ILearningRecordIngester.ts
 * Source: phase8-contracts-v1.md §3.1
 */
import type { ExecutionOutcomeDTO, LearningRecordDTO } from '../dtos/inputs';

export interface ILearningRecordIngester {
  ingestBatch(
    strategy_run_id: string,
    period_start: Date,
    period_end: Date
  ): Promise<LearningRecordDTO[]>;

  loadExecutionOutcomes(signal_ids: string[]): Promise<Map<string, ExecutionOutcomeDTO>>;
}
