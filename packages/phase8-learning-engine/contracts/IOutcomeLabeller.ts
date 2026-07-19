/**
 * phase8/contracts/IOutcomeLabeller.ts
 * Source: phase8-contracts-v1.md §3.3
 */
import type { ExecutionOutcomeDTO, LabelledOutcomeDTO, LearningRecordDTO } from '../dtos/inputs';
import { LabellingError } from '../errors/Phase8Error';

export interface IOutcomeLabeller {
  label(record: LearningRecordDTO, execution_outcome: ExecutionOutcomeDTO | null): LabelledOutcomeDTO;

  labelBatch(
    records: LearningRecordDTO[],
    outcomes: Map<string, ExecutionOutcomeDTO>
  ): [LabelledOutcomeDTO[], LabellingError[]];
}
