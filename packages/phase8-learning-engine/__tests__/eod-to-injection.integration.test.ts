/**
 * phase8/__tests__/eod-to-injection.integration.test.ts
 * Covers roadmap Step 15/16 integration test spec.
 *
 * These tests exercise LearningEngine + scheduler wiring against fakes that
 * behave like a real DB (in-memory maps) rather than full mocks, so the
 * cross-call sequencing is actually verified end-to-end, not just per-call
 * assertions. Swap the fakes for a real test-DB-backed repository set to run
 * this against Postgres — the test bodies themselves don't change.
 */
import { LearningEngine } from '../LearningEngine';
import { Phase8StartupCheck } from '../scheduler/Phase8StartupCheck';
import { PreMarketInjectionJob } from '../scheduler/PreMarketInjectionJob';

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

/** Minimal in-memory fake of ITrainingRunRepository — behaves like a real table. */
function makeFakeTrainingRunRepo() {
  const rows = new Map<string, any>();
  return {
    rows,
    save: jest.fn(async (run: any) => {
      rows.set(run.training_run_id, { ...run });
    }),
    updateStatus: jest.fn(async (id: string, status: string, extra?: any) => {
      const row = rows.get(id);
      if (row) Object.assign(row, { status, ...(extra ?? {}) });
    }),
    findById: jest.fn(async (id: string) => rows.get(id) ?? null),
    findLatestCompleted: jest.fn(async (strategy_run_id: string) => {
      const matches = [...rows.values()].filter(
        (r) => r.strategy_run_id === strategy_run_id && (r.status === 'TRAINED' || r.status === 'INJECTED')
      );
      return matches.length ? matches[matches.length - 1] : null;
    }),
    findInProgress: jest.fn(async (strategy_run_id: string) => {
      const nonTerminal = ['PENDING', 'INGESTING', 'FEATURE_EXTRACTING', 'OUTCOME_LABELLING', 'AGGREGATING', 'TRAINING'];
      const match = [...rows.values()].find(
        (r) => r.strategy_run_id === strategy_run_id && nonTerminal.includes(r.status)
      );
      return match ?? null;
    }),
  };
}

describe('Integration: full EOD run against fake DB', () => {
  it('seeds learning_records-equivalent data and drives the run to TRAINED', async () => {
    const trainingRunRepo = makeFakeTrainingRunRepo();
    const seededRecords = [
      { signal_id: 'sig-1', regime_label: 'BULL', symbol_id: null, timeframe: '1d' },
      { signal_id: 'sig-2', regime_label: 'BULL', symbol_id: null, timeframe: '1d' },
    ];

    const ingester = {
      ingestBatch: jest.fn().mockResolvedValue(seededRecords),
      loadExecutionOutcomes: jest.fn().mockResolvedValue(new Map()),
    };
    const featurePipeline = { extractBatch: jest.fn().mockResolvedValue([]) };
    const outcomeLabeller = {
      labelBatch: jest.fn().mockReturnValue([
        seededRecords.map((r) => ({ ...r, was_winner: true, actual_return: 0.01, mae: 0.001, mfe: 0.02 })),
        [],
      ]),
    };
    const performanceAggregator = { aggregate: jest.fn().mockResolvedValue([]) };
    const indicatorPerfCalculator = { calculate: jest.fn().mockResolvedValue([]) };
    const strategyPerfRepo = { upsertBatch: jest.fn().mockResolvedValue(undefined) };
    const indicatorPerfRepo = { upsertBatch: jest.fn().mockResolvedValue(undefined) };
    const regimePriorUpdater = { compute: jest.fn().mockResolvedValue([]), activate: jest.fn() };
    const regimePerformanceRepo = { upsertBatch: jest.fn().mockResolvedValue(undefined) };
    const modelTrainer = { trainAll: jest.fn().mockResolvedValue([]) };
    const modelRegistry = {
      register: jest.fn().mockResolvedValue(undefined),
      activate: jest.fn(),
      getCurrent: jest.fn(),
      getHistory: jest.fn(),
      getAllCurrentForRun: jest.fn().mockResolvedValue([]),
    };
    const injectionOrchestrator = { assemble: jest.fn(), deliver: jest.fn() };
    const logger = makeLogger();

    const engine = new LearningEngine(
      trainingRunRepo as any,
      ingester as any,
      featurePipeline as any,
      outcomeLabeller as any,
      performanceAggregator as any,
      indicatorPerfCalculator as any,
      strategyPerfRepo as any,
      indicatorPerfRepo as any,
      regimePriorUpdater as any,
      regimePerformanceRepo as any,
      modelTrainer as any,
      modelRegistry as any,
      injectionOrchestrator as any,
      logger as any
    );

    const training_run_id = await engine.triggerEodRun('strat-1', new Date(), 'MANUAL');

    // Poll status until terminal, same pattern a real caller would use.
    let row = await trainingRunRepo.findById(training_run_id);
    for (let i = 0; i < 20 && row && !['TRAINED', 'TRAINED_UNRELIABLE', 'FAILED'].includes(row.status); i++) {
      await new Promise((r) => setImmediate(r));
      row = await trainingRunRepo.findById(training_run_id);
    }

    // record_count (2) < MIN_SAMPLE_SIZE (30) → TRAINED_UNRELIABLE, not TRAINED.
    // Confirms the reliability gate is wired correctly end-to-end.
    expect(row.status).toBe('TRAINED_UNRELIABLE');
    expect(ingester.ingestBatch).toHaveBeenCalled();
    expect(outcomeLabeller.labelBatch).toHaveBeenCalled();
    expect(modelTrainer.trainAll).toHaveBeenCalled();
  });
});

describe('Integration: injection against fake DB + mock Phase 5', () => {
  it('activates delivered model versions after a successful deliver()', async () => {
    const trainingRunRepo = makeFakeTrainingRunRepo();
    await trainingRunRepo.save({
      training_run_id: 'run-trained',
      strategy_run_id: 'strat-1',
      status: 'TRAINED',
    });

    const modelRegistry = { activate: jest.fn().mockResolvedValue(undefined), getAllCurrentForRun: jest.fn() };
    const injectionOrchestrator = {
      assemble: jest.fn().mockResolvedValue({
        strategy_run_id: 'strat-1',
        assembled_at: new Date(),
        model_versions: [{ model_version_id: 'mv-1' }],
      }),
      deliver: jest.fn().mockResolvedValue({
        strategy_run_id: 'strat-1',
        injected_at: new Date(),
        model_version_ids: ['mv-1'],
        injection_latency_ms: 12,
        quality_model_injected: true,
        win_rate_provider_injected: true,
      }),
    };
    const logger = makeLogger();
    const noop = { ingestBatch: jest.fn(), loadExecutionOutcomes: jest.fn() };

    const engine = new LearningEngine(
      trainingRunRepo as any,
      noop as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      modelRegistry as any,
      injectionOrchestrator as any,
      logger as any
    );

    const signalEngine = { setQualityModel: jest.fn() };
    const kellyCalculator = { setWinRateProvider: jest.fn() };
    await engine.injectIntoPhase5('strat-1', signalEngine, kellyCalculator);

    expect(injectionOrchestrator.deliver).toHaveBeenCalled();
    expect(modelRegistry.activate).toHaveBeenCalledWith('mv-1');
    const row = await trainingRunRepo.findById('run-trained');
    expect(row.status).toBe('INJECTED');
  });
});

describe('Integration: crash recovery via Phase8StartupCheck', () => {
  it('simulated crash mid-training (stuck in INGESTING) is marked FAILED on startup', async () => {
    const trainingRunRepo = makeFakeTrainingRunRepo();
    await trainingRunRepo.save({
      training_run_id: 'stuck-run',
      strategy_run_id: 'strat-1',
      status: 'INGESTING',
    });

    const injectionJob = { run: jest.fn() };
    const logger = makeLogger();
    const check = new Phase8StartupCheck(trainingRunRepo as any, injectionJob as any, logger as any);

    await check.run('strat-1', { setQualityModel: jest.fn() }, { setWinRateProvider: jest.fn() });

    const row = await trainingRunRepo.findById('stuck-run');
    expect(row.status).toBe('FAILED');
    expect(row.failure_reason).toBe('UNKNOWN');
    expect(injectionJob.run).not.toHaveBeenCalled();
  });

  it('simulated crash mid-injection (left in TRAINED) triggers a re-attempt on startup', async () => {
    const trainingRunRepo = makeFakeTrainingRunRepo();
    await trainingRunRepo.save({
      training_run_id: 'trained-run',
      strategy_run_id: 'strat-1',
      status: 'TRAINED',
    });

    const learningEngine = { injectIntoPhase5: jest.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();
    const injectionJob = new PreMarketInjectionJob(learningEngine as any, logger as any);
    const check = new Phase8StartupCheck(trainingRunRepo as any, injectionJob, logger as any);

    await check.run('strat-1', { setQualityModel: jest.fn() }, { setWinRateProvider: jest.fn() });

    expect(learningEngine.injectIntoPhase5).toHaveBeenCalledWith(
      'strat-1',
      expect.anything(),
      expect.anything()
    );
  });
});
