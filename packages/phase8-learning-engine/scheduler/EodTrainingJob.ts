/**
 * phase8/scheduler/EodTrainingJob.ts
 * Source: phase8-implementation-roadmap-v1.md Step 16; phase8-persistence-design-v1.md §6.3, §8 (migration 026)
 *
 * Handler invoked by the pg_cron-registered job `phase8_eod_training`
 * (schedule '30 13 * * 1-5' = 18:30 IST, weekdays — migration 026, DB-owned).
 * Wiring only — implements no Phase 8 contract interface.
 *
 * Failure handling: per runtime-flow §10 Failure Matrix (F1) and roadmap
 * Step 16 unit test spec, this handler must NEVER throw — pg_cron treats a
 * thrown error as job failure and will alert/retry in ways Phase 8 doesn't
 * want (the correct retry for a missed/failed EOD run is simply "next day's
 * scheduled window", not an immediate pg_cron-level retry). Every error,
 * including the expected ConcurrentTrainingRunError, is caught and logged.
 */
import type { ILearningEngine } from '../contracts/ILearningEngine';
import { ConcurrentTrainingRunError } from '../errors/Phase8Error';

interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export class EodTrainingJob {
  constructor(
    private readonly learningEngine: ILearningEngine,
    private readonly logger: Logger
  ) {}

  /**
   * Runs the EOD trigger for one strategy_run_id. Called once per active
   * strategy_run_id by RuntimeScheduler at 18:30 IST (or manually, for a
   * backfill/replay).
   */
  async run(strategy_run_id: string, period_end: Date, trigger_source: 'PG_CRON' | 'MANUAL' = 'PG_CRON'): Promise<void> {
    try {
      const training_run_id = await this.learningEngine.triggerEodRun(strategy_run_id, period_end, trigger_source);
      this.logger.info('EodTrainingJob.run: triggered', { strategy_run_id, training_run_id, trigger_source });
    } catch (err) {
      if (err instanceof ConcurrentTrainingRunError) {
        // Expected, benign — a run is already in flight (e.g. previous
        // day's run overran, or a manual trigger raced the cron window).
        // Logged as warning, not rethrown, per roadmap Step 16 unit test spec.
        this.logger.warn('EodTrainingJob.run: concurrent run already in progress — skipping', {
          strategy_run_id,
          existing_run_id: err.existing_run_id,
          existing_status: err.existing_status,
        });
        return;
      }
      // Any other failure: log and swallow. pg_cron must not error — the
      // correct recovery path is the next scheduled window (runtime-flow §10, F1).
      this.logger.error('EodTrainingJob.run: unexpected failure — will retry next scheduled window', {
        strategy_run_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
