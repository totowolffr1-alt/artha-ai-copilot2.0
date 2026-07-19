/**
 * phase8/contracts/ILearningEngine.ts
 * Source: phase8-contracts-v1.md §2.1
 */
import type { TrainingRunId } from '../domain/types';
import type { ISignalQualityModel, IWinRateProvider } from '../phase5/contracts';

export interface ILearningEngine {
  triggerEodRun(
    strategy_run_id: string,
    period_end: Date,
    trigger_source: 'PG_CRON' | 'MANUAL'
  ): Promise<TrainingRunId>;

  injectIntoPhase5(
    strategy_run_id: string,
    signalEngine: { setQualityModel: (m: ISignalQualityModel) => void },
    kellyCalculator: { setWinRateProvider: (p: IWinRateProvider) => void }
  ): Promise<void>;

  hasReadyModel(strategy_run_id: string): Promise<boolean>;
}
