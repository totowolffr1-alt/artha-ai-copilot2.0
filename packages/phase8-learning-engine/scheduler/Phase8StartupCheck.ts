/**
 * phase8/scheduler/Phase8StartupCheck.ts
 * Source: phase8-implementation-roadmap-v1.md Step 16; phase8-runtime-flow-v1.md §9.4 (startup ordering)
 *
 * Runs once at system boot, after Phase 9's KillSwitch reaches ACTIVE
 * (runtime-flow §9.4 — Phase 8 does not start its own checks before that).
 * Two responsibilities:
 *   1. Crash recovery: any TrainingRun left in a non-terminal status from a
 *      prior process crash is marked FAILED(UNKNOWN) — it cannot be safely
 *      resumed mid-pipeline (no partial-stage resume defined anywhere in the
 *      architecture), so it is abandoned; the next pg_cron window produces a
 *      fresh run.
 *   2. Injection catch-up: if the latest run for a strategy is already
 *      TRAINED (crash happened after training but before/during injection),
 *      attempt injection now rather than waiting for the next 08:45 window.
 * Wiring only — implements no Phase 8 contract interface.
 */
import type { ITrainingRunRepository } from '../repositories/ITrainingRunRepository';
import type { PreMarketInjectionJob } from './PreMarketInjectionJob';
import type { ISignalQualityModel, IWinRateProvider } from '../phase5/contracts';

interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

type SignalEngineLike = { setQualityModel: (m: ISignalQualityModel) => void };
type KellyCalculatorLike = { setWinRateProvider: (p: IWinRateProvider) => void };

export class Phase8StartupCheck {
  constructor(
    private readonly trainingRunRepo: ITrainingRunRepository,
    private readonly injectionJob: PreMarketInjectionJob,
    private readonly logger: Logger
  ) {}

  /**
   * Run the startup check for one strategy_run_id. RuntimeScheduler calls
   * this once per active strategy_run_id, sequenced after Phase 9 reports ACTIVE.
   */
  async run(
    strategy_run_id: string,
    signalEngine: SignalEngineLike,
    kellyCalculator: KellyCalculatorLike
  ): Promise<void> {
    const inProgress = await this.trainingRunRepo.findInProgress(strategy_run_id);

    if (inProgress !== null) {
      this.logger.error('Phase8StartupCheck.run: found in-progress run from prior crash — marking FAILED', {
        strategy_run_id,
        training_run_id: inProgress.training_run_id,
        stuck_at_status: inProgress.status,
      });
      await this.trainingRunRepo.updateStatus(inProgress.training_run_id, 'FAILED', {
        completed_at: new Date(),
        failure_reason: 'UNKNOWN',
      });
      // Do not attempt injection this cycle — proceed to next pg_cron window
      // for a clean run, per runtime-flow §10 recovery guidance for F1-class failures.
      return;
    }

    this.logger.info('Phase8StartupCheck.run: no in-progress run found — checking for pending injection', {
      strategy_run_id,
    });

    const latest = await this.trainingRunRepo.findLatestCompleted(strategy_run_id);
    if (latest !== null && latest.status === 'TRAINED') {
      this.logger.info('Phase8StartupCheck.run: latest run is TRAINED — attempting catch-up injection', {
        strategy_run_id,
        training_run_id: latest.training_run_id,
      });
      await this.injectionJob.run(strategy_run_id, signalEngine, kellyCalculator);
    }
  }
}
