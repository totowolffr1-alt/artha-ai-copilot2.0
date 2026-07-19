/**
 * phase8/scheduler/RuntimeScheduler.ts
 *
 * NOT part of the original roadmap file list for Step 16 (which specifies
 * EodTrainingJob.ts, PreMarketInjectionJob.ts, Phase8StartupCheck.ts only).
 * Added additively per explicit request — a thin composition root that owns
 * the in-process schedule and calls those three files at the right times.
 * Implements no Phase 8 contract interface; wiring only, same as its siblings.
 *
 * Why in-process scheduling, not a pg_cron→Node bridge: migration 026
 * (persistence-design §6.3, §8) already registers `phase8_eod_training`
 * ('30 13 * * 1-5' UTC = 18:30 IST) as a DB-side pg_cron job — but pg_cron
 * invokes SQL/plpgsql, not Node code, and no bridge mechanism (LISTEN/NOTIFY,
 * webhook, polling table) is specified anywhere in the architecture docs for
 * getting that trigger into this Node process. Rather than invent one (that
 * would be a real design addition), this scheduler independently reproduces
 * the same two IST windows in-process using the same schedule Phase 8's own
 * persistence design already committed to (18:30 and 08:45 IST, weekdays).
 * If/when a DB→Node bridge is specified, this class's `tick()` is the single
 * place to swap the trigger source — nothing else in Phase 8 changes.
 */
import { EodTrainingJob } from './EodTrainingJob';
import { PreMarketInjectionJob } from './PreMarketInjectionJob';
import { Phase8StartupCheck } from './Phase8StartupCheck';
import type { ISignalQualityModel, IWinRateProvider } from '../phase5/contracts';

interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

type SignalEngineLike = { setQualityModel: (m: ISignalQualityModel) => void };
type KellyCalculatorLike = { setWinRateProvider: (p: IWinRateProvider) => void };

export interface Phase5Refs {
  signalEngine: SignalEngineLike;
  kellyCalculator: KellyCalculatorLike;
}

const IST_OFFSET_MINUTES = 5 * 60 + 30; // UTC+5:30
const EOD_TRIGGER_IST = { hour: 18, minute: 30 }; // matches migration 026 pg_cron schedule
const INJECTION_TRIGGER_IST = { hour: 8, minute: 45 };
const TICK_INTERVAL_MS = 60_000; // check once per minute — cron-minute granularity

export class RuntimeScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFiredMinuteKey: string | null = null;

  constructor(
    private readonly eodJob: EodTrainingJob,
    private readonly injectionJob: PreMarketInjectionJob,
    private readonly startupCheck: Phase8StartupCheck,
    private readonly strategyRunIds: string[],
    private readonly phase5Refs: Map<string, Phase5Refs>,
    private readonly logger: Logger
  ) {}

  /**
   * Runtime startup sequence:
   *   1. Caller has already confirmed Phase 9 KillSwitch = ACTIVE
   *      (runtime-flow §9.4 — this class does not check that itself; it's
   *      the bootstrap's job to not construct/start this scheduler earlier).
   *   2. Run Phase8StartupCheck once per strategy_run_id (crash recovery +
   *      injection catch-up).
   *   3. Begin the recurring tick that fires EodTrainingJob / PreMarketInjectionJob
   *      at their IST windows going forward.
   */
  async start(): Promise<void> {
    this.logger.info('RuntimeScheduler.start: running startup checks', {
      strategy_run_ids: this.strategyRunIds,
    });

    for (const strategy_run_id of this.strategyRunIds) {
      const refs = this.phase5Refs.get(strategy_run_id);
      if (!refs) {
        this.logger.error('RuntimeScheduler.start: no Phase 5 refs registered — skipping startup check', {
          strategy_run_id,
        });
        continue;
      }
      await this.startupCheck.run(strategy_run_id, refs.signalEngine, refs.kellyCalculator);
    }

    // Run one tick immediately — setInterval only fires *after* its delay
    // elapses, so without this the very first trigger-minute (e.g. exactly
    // 18:30:00 IST at process start) would never be checked; the first
    // interval-driven tick wouldn't land until 60s later, already past the
    // minute window.
    await this.tick().catch((err) => {
      this.logger.error('RuntimeScheduler.tick: unexpected failure on initial tick — scheduler continues', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        this.logger.error('RuntimeScheduler.tick: unexpected failure — scheduler continues', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, TICK_INTERVAL_MS);

    this.logger.info('RuntimeScheduler.start: recurring tick armed', { interval_ms: TICK_INTERVAL_MS });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Fires at most once per calendar minute per window, weekdays only
   * (Mon-Fri, matching migration 026's '1-5' cron field). Idempotent within
   * the same minute — a slow tick or a restart within the same minute cannot
   * double-fire.
   */
  private async tick(): Promise<void> {
    const now = new Date();
    const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
    const weekday = ist.getUTCDay(); // 0=Sun..6=Sat, computed on the shifted clock
    const hour = ist.getUTCHours();
    const minute = ist.getUTCMinutes();
    const minuteKey = `${ist.getUTCFullYear()}-${ist.getUTCMonth()}-${ist.getUTCDate()}-${hour}-${minute}`;

    if (weekday === 0 || weekday === 6) return; // weekends — no jobs (cron '1-5')
    if (minuteKey === this.lastFiredMinuteKey) return;

    if (hour === EOD_TRIGGER_IST.hour && minute === EOD_TRIGGER_IST.minute) {
      this.lastFiredMinuteKey = minuteKey;
      await this.fireEodTraining();
      return;
    }

    if (hour === INJECTION_TRIGGER_IST.hour && minute === INJECTION_TRIGGER_IST.minute) {
      this.lastFiredMinuteKey = minuteKey;
      await this.fireInjection();
      return;
    }
  }

  /** End-to-end EOD sequence: fan out EodTrainingJob to every active strategy_run_id. */
  private async fireEodTraining(): Promise<void> {
    const period_end = new Date();
    this.logger.info('RuntimeScheduler: 18:30 IST window — firing EOD training', {
      strategy_run_ids: this.strategyRunIds,
    });
    for (const strategy_run_id of this.strategyRunIds) {
      await this.eodJob.run(strategy_run_id, period_end, 'PG_CRON');
    }
  }

  /** End-to-end injection sequence: fan out PreMarketInjectionJob to every active strategy_run_id. */
  private async fireInjection(): Promise<void> {
    this.logger.info('RuntimeScheduler: 08:45 IST window — firing pre-market injection', {
      strategy_run_ids: this.strategyRunIds,
    });
    for (const strategy_run_id of this.strategyRunIds) {
      const refs = this.phase5Refs.get(strategy_run_id);
      if (!refs) {
        this.logger.error('RuntimeScheduler: no Phase 5 refs registered — skipping injection', {
          strategy_run_id,
        });
        continue;
      }
      await this.injectionJob.run(strategy_run_id, refs.signalEngine, refs.kellyCalculator);
    }
  }
}
