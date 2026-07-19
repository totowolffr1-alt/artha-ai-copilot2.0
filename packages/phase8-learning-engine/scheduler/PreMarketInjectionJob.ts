/**
 * phase8/scheduler/PreMarketInjectionJob.ts
 * Source: phase8-implementation-roadmap-v1.md Step 16; phase8-runtime-flow-v1.md §3.2, §9.4
 *
 * Startup hook invoked at 08:45 IST (system startup or scheduled injection
 * window) — must run after Phase 9's KillSwitch reaches ACTIVE (§9.4 ordering).
 * Wiring only — implements no Phase 8 contract interface.
 */
import type { ILearningEngine } from '../contracts/ILearningEngine';
import type { ISignalQualityModel, IWinRateProvider } from '../phase5/contracts';
import { InjectionTimeoutError, InjectionPartialError } from '../errors/Phase8Error';

interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

type SignalEngineLike = { setQualityModel: (m: ISignalQualityModel) => void };
type KellyCalculatorLike = { setWinRateProvider: (p: IWinRateProvider) => void };

export class PreMarketInjectionJob {
  constructor(
    private readonly learningEngine: ILearningEngine,
    private readonly logger: Logger
  ) {}

  /**
   * Attempts injection for one strategy_run_id. Per roadmap Step 16
   * acceptance criteria: "INJECTION_TIMEOUT elapsed without Phase 5 ack →
   * InjectionTimeoutError logged; system continues" — this handler never
   * propagates a failure up into the startup sequence. A failed injection
   * means Phase 5 runs in degraded mode (runtime-flow §2.2) for the session,
   * not that the system fails to start.
   */
  async run(
    strategy_run_id: string,
    signalEngine: SignalEngineLike,
    kellyCalculator: KellyCalculatorLike
  ): Promise<void> {
    try {
      await this.learningEngine.injectIntoPhase5(strategy_run_id, signalEngine, kellyCalculator);
      this.logger.info('PreMarketInjectionJob.run: injection attempted', { strategy_run_id });
    } catch (err) {
      if (err instanceof InjectionTimeoutError) {
        this.logger.error('PreMarketInjectionJob.run: injection timed out — system continues in degraded mode', {
          strategy_run_id,
          timeout_ms: err.timeout_ms,
        });
        return;
      }
      if (err instanceof InjectionPartialError) {
        this.logger.error('PreMarketInjectionJob.run: partial injection — system continues in degraded mode', {
          strategy_run_id,
          quality_model_injected: err.quality_model_injected,
          win_rate_provider_injected: err.win_rate_provider_injected,
        });
        return;
      }
      this.logger.error('PreMarketInjectionJob.run: unexpected failure — system continues without injection', {
        strategy_run_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
