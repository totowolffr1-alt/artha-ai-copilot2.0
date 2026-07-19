/**
 * phase8/LearningEngine.ts
 * Implements: ILearningEngine (phase8-contracts-v1.md §2.1)
 * Enforces: I-09 (no concurrent training runs per strategy_run_id)
 * Source: phase8-runtime-flow-v1.md §3.1 (EOD sequence), §3.2 (injection sequence), §9.3 (KillSwitch)
 *
 * The single public surface Phase 8 exposes. No other phase holds a reference
 * to any Phase 8 internal — everything below is wired in via this facade's
 * constructor and never touched directly by callers.
 */
import { randomUUID } from 'crypto';
import type { ILearningEngine } from './contracts/ILearningEngine';
import type { ITrainingRunRepository } from './repositories/ITrainingRunRepository';
import type { ILearningRecordIngester } from './contracts/ILearningRecordIngester';
import type { IFeaturePipeline } from './contracts/IFeaturePipeline';
import type { IOutcomeLabeller } from './contracts/IOutcomeLabeller';
import type { IPerformanceAggregator } from './contracts/IPerformanceAggregator';
import type { IIndicatorPerformanceCalculator } from './contracts/IIndicatorPerformanceCalculator';
import type { IStrategyPerformanceRepository,} from './repositories/IStrategyPerformanceRepository';
import type { IIndicatorPerformanceRepository } from './repositories/IIndicatorPerformanceRepository';
import type { IRegimePriorUpdater } from './contracts/IRegimePriorUpdater';
import type { IRegimePerformanceRepository } from './repositories/IRegimePerformanceRepository';
import type { IModelTrainer } from './contracts/IModelTrainer';
import type { IModelRegistry } from './contracts/IModelRegistry';
import type { IInjectionOrchestrator } from './contracts/IInjectionOrchestrator';
import type { ISignalQualityModel, IWinRateProvider } from './phase5/contracts';
import type { TrainingRunId } from './domain/types';
import type { TrainingRunDTO } from './dtos/outputs';
import { ConcurrentTrainingRunError, InjectionTimeoutError } from './errors/Phase8Error';

interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const MIN_SAMPLE_SIZE = 30; // phase8-domain-model-v1.md §8.1

export class LearningEngine implements ILearningEngine {
  constructor(
    private readonly trainingRunRepo: ITrainingRunRepository,
    private readonly ingester: ILearningRecordIngester,
    private readonly featurePipeline: IFeaturePipeline,
    private readonly outcomeLabeller: IOutcomeLabeller,
    private readonly performanceAggregator: IPerformanceAggregator,
    private readonly indicatorPerfCalculator: IIndicatorPerformanceCalculator,
    private readonly strategyPerfRepo: IStrategyPerformanceRepository,
    private readonly indicatorPerfRepo: IIndicatorPerformanceRepository,
    private readonly regimePriorUpdater: IRegimePriorUpdater,
    private readonly regimePerformanceRepo: IRegimePerformanceRepository,
    private readonly modelTrainer: IModelTrainer,
    private readonly modelRegistry: IModelRegistry,
    private readonly injectionOrchestrator: IInjectionOrchestrator,
    private readonly logger: Logger
  ) {}

  /**
   * Non-blocking: creates the TrainingRun row and returns its id immediately;
   * the pipeline itself runs asynchronously (fire-and-forget from the caller's
   * point of view, but every stage transition and failure is persisted so it
   * can be observed via ITrainingRunRepository, and recovered by
   * Phase8StartupCheck if the process crashes mid-run).
   */
  async triggerEodRun(
    strategy_run_id: string,
    period_end: Date,
    trigger_source: 'PG_CRON' | 'MANUAL'
  ): Promise<TrainingRunId> {
    const inProgress = await this.trainingRunRepo.findInProgress(strategy_run_id);
    if (inProgress !== null) {
      throw new ConcurrentTrainingRunError(strategy_run_id, inProgress.training_run_id, inProgress.status);
    }

    const training_run_id = randomUUID() as TrainingRunId;
    const period_start = new Date(period_end);
    period_start.setDate(period_start.getDate() - 1); // one EOD batch = one trading day, per runtime-flow §1

    const run: TrainingRunDTO = {
      training_run_id,
      strategy_run_id,
      period_start,
      period_end,
      period_type: 'DAILY',
      status: 'PENDING',
      record_count: 0,
      labelled_count: 0,
      reliable: false,
      model_version_id: null,
      triggered_at: new Date(),
      completed_at: null,
      failure_reason: null,
    };

    await this.trainingRunRepo.save(run);
    this.logger.info('LearningEngine.triggerEodRun: run created', {
      training_run_id,
      strategy_run_id,
      trigger_source,
    });

    // Fire-and-forget: caller gets training_run_id immediately per contract.
    // Every failure inside is caught and persisted as TrainingRun.FAILED —
    // never surfaces as an unhandled rejection.
    void this.runPipeline(run).catch((err) => {
      this.logger.error('LearningEngine.triggerEodRun: unhandled pipeline failure', {
        training_run_id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return training_run_id;
  }

  /**
   * The full EOD pipeline, runtime-flow §3.1, stage by stage. Each stage
   * transition is persisted before the next stage starts, so a crash mid-run
   * leaves an observable, recoverable status (Phase8StartupCheck reads this).
   */
  private async runPipeline(run: TrainingRunDTO): Promise<void> {
    const { training_run_id, strategy_run_id, period_start, period_end } = run;

    try {
      // [INGESTING]
      await this.trainingRunRepo.updateStatus(training_run_id, 'INGESTING');
      const records = await this.ingester.ingestBatch(strategy_run_id, period_start, period_end);
      const signalIds = records.map((r) => r.signal_id);
      const validSignalIds = signalIds.filter((id): id is string => id !== null);
const executionOutcomes = await this.ingester.loadExecutionOutcomes(validSignalIds);
      const recordCount = records.length;
      // Note: TrainingRunDTO.record_count/labelled_count are mutable per the
      // domain model, but ITrainingRunRepository.updateStatus()'s `extra`
      // param (contracts §4.1) only accepts completed_at/failure_reason/
      // model_version_id — no setter for record_count exists on the
      // interface. Tracked in-memory through this pipeline run; persisting
      // it is a repository-interface gap out of scope for this module.

      if (recordCount === 0) {
        this.logger.warn('LearningEngine.runPipeline: zero records ingested', {
          training_run_id,
          strategy_run_id,
        });
      }

      // [FEATURE_EXTRACTING]
      await this.trainingRunRepo.updateStatus(training_run_id, 'FEATURE_EXTRACTING');
      const vectors = await this.featurePipeline.extractBatch(records);

      // [OUTCOME_LABELLING]
      await this.trainingRunRepo.updateStatus(training_run_id, 'OUTCOME_LABELLING');
      const [corpus, labellingErrors] = this.outcomeLabeller.labelBatch(records, executionOutcomes);

      // [AGGREGATING]
      await this.trainingRunRepo.updateStatus(training_run_id, 'AGGREGATING');
      const summaries = await this.performanceAggregator.aggregate(
        training_run_id,
        strategy_run_id,
        corpus,
        period_end
      );
      await this.strategyPerfRepo.upsertBatch(summaries);

      const indicatorPerfs = await this.indicatorPerfCalculator.calculate(
        training_run_id,
        strategy_run_id,
        corpus,
        corpus.map((c) => c.feature_vector)
      );
      await this.indicatorPerfRepo.upsertBatch(indicatorPerfs);

      const regimePriors = await this.regimePriorUpdater.compute(training_run_id, corpus, indicatorPerfs);
      for (const prior of regimePriors) {
        await this.regimePriorUpdater.activate(prior);
      }
      await this.regimePerformanceRepo.upsertBatch(regimePriors);

      // [TRAINING]
      await this.trainingRunRepo.updateStatus(training_run_id, 'TRAINING');
      const modelVersions = await this.modelTrainer.trainAll(corpus);
      for (const [, model] of modelVersions) {
  await this.modelRegistry.register(model);
      }

      const reliable = recordCount >= MIN_SAMPLE_SIZE;
      const finalStatus = reliable ? 'TRAINED' : 'TRAINED_UNRELIABLE';

      await this.trainingRunRepo.updateStatus(training_run_id, finalStatus, {
        model_version_id: Array.from(modelVersions.values())[0]?.model_version_id ?? null,
      });

      this.logger.info('LearningEngine.runPipeline: finished', {
        training_run_id,
        strategy_run_id,
        status: finalStatus,
        record_count: recordCount,
      });
    } catch (err) {
      this.logger.error('LearningEngine.runPipeline: failed', {
        training_run_id,
        strategy_run_id,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.trainingRunRepo.updateStatus(training_run_id, 'FAILED', {
        completed_at: new Date(),
        failure_reason: 'UNKNOWN',
      });
    }
  }

  /**
   * Pre-market injection, runtime-flow §3.2. No-op (warning only, never
   * throws for these two cases) when there's nothing safe to inject.
   * Timeout/partial-injection errors from InjectionOrchestrator.deliver()
   * propagate — contract explicitly documents InjectionTimeoutError as thrown.
   */
  async injectIntoPhase5(
    strategy_run_id: string,
    signalEngine: { setQualityModel: (m: ISignalQualityModel) => void },
    kellyCalculator: { setWinRateProvider: (p: IWinRateProvider) => void }
  ): Promise<void> {
    const latest = await this.trainingRunRepo.findLatestCompleted(strategy_run_id);

    if (latest === null) {
      this.logger.warn('LearningEngine.injectIntoPhase5: no completed run — skipping', { strategy_run_id });
      return;
    }
    if (latest.status === 'TRAINED_UNRELIABLE') {
      this.logger.warn('LearningEngine.injectIntoPhase5: latest run unreliable — skipping', {
        strategy_run_id,
        training_run_id: latest.training_run_id,
      });
      return;
    }
    if (latest.status !== 'TRAINED') {
      this.logger.warn('LearningEngine.injectIntoPhase5: latest run not in TRAINED state — skipping', {
        strategy_run_id,
        status: latest.status,
      });
      return;
    }

    const payload = await this.injectionOrchestrator.assemble(strategy_run_id);
    if (payload === null) {
      this.logger.warn('LearningEngine.injectIntoPhase5: assemble() returned null — skipping', {
        strategy_run_id,
      });
      return;
    }

    // Let InjectionTimeoutError / InjectionPartialError propagate — contract
    // documents InjectionTimeoutError as explicitly thrown from this method.
    const result = await this.injectionOrchestrator.deliver(payload, signalEngine, kellyCalculator);

    // Activation happens here, one level above InjectionOrchestrator, per
    // runtime-flow §3.2 — deliver() only delivers; activate() is this
    // facade's responsibility once delivery is confirmed successful.
    for (const model_version_id of result.model_version_ids) {
      await this.modelRegistry.activate(model_version_id);
    }

    await this.trainingRunRepo.updateStatus(latest.training_run_id, 'INJECTED', {
      completed_at: new Date(),
    });

    this.logger.info('LearningEngine.injectIntoPhase5: finished', {
      strategy_run_id,
      training_run_id: latest.training_run_id,
      model_version_ids: result.model_version_ids,
    });
  }

  async hasReadyModel(strategy_run_id: string): Promise<boolean> {
    const versions = await this.modelRegistry.getAllCurrentForRun(strategy_run_id);
    return versions.some((v) => v.is_ready);
  }
}
