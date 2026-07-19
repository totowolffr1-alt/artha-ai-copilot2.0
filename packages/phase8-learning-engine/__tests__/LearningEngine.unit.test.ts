/**
 * phase8/__tests__/LearningEngine.unit.test.ts
 * Covers roadmap Step 15 unit test spec exactly.
 * Framework: Jest-style (describe/it/expect) — adjust imports if the
 * project's actual test runner differs; no runner-specific API used beyond
 * the common subset.
 */
import { LearningEngine } from '../LearningEngine';
import { ConcurrentTrainingRunError } from '../errors/Phase8Error';

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeDeps() {
  const trainingRunRepo = {
    save: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findLatestCompleted: jest.fn(),
    findInProgress: jest.fn().mockResolvedValue(null),
  };
  const ingester = {
    ingestBatch: jest.fn().mockResolvedValue([]),
    loadExecutionOutcomes: jest.fn().mockResolvedValue(new Map()),
  };
  const featurePipeline = { extractBatch: jest.fn().mockResolvedValue([]) };
  const outcomeLabeller = { labelBatch: jest.fn().mockReturnValue([[], []]) };
  const performanceAggregator = { aggregate: jest.fn().mockResolvedValue([]) };
  const indicatorPerfCalculator = { calculate: jest.fn().mockResolvedValue([]) };
  const strategyPerfRepo = { upsertBatch: jest.fn().mockResolvedValue(undefined) };
  const indicatorPerfRepo = { upsertBatch: jest.fn().mockResolvedValue(undefined) };
  const regimePriorUpdater = {
    compute: jest.fn().mockResolvedValue([]),
    activate: jest.fn().mockResolvedValue(undefined),
  };
  const regimePerformanceRepo = { upsertBatch: jest.fn().mockResolvedValue(undefined) };
  const modelTrainer = { trainAll: jest.fn().mockResolvedValue([]) };
  const modelRegistry = {
    register: jest.fn().mockResolvedValue(undefined),
    activate: jest.fn().mockResolvedValue(undefined),
    getCurrent: jest.fn(),
    getHistory: jest.fn(),
    getAllCurrentForRun: jest.fn().mockResolvedValue([]),
  };
  const injectionOrchestrator = {
    assemble: jest.fn(),
    deliver: jest.fn(),
  };
  const logger = makeLogger();

  return {
    trainingRunRepo,
    ingester,
    featurePipeline,
    outcomeLabeller,
    performanceAggregator,
    indicatorPerfCalculator,
    strategyPerfRepo,
    indicatorPerfRepo,
    regimePriorUpdater,
    regimePerformanceRepo,
    modelTrainer,
    modelRegistry,
    injectionOrchestrator,
    logger,
  };
}

function makeEngine(deps: ReturnType<typeof makeDeps>) {
  return new LearningEngine(
    deps.trainingRunRepo as any,
    deps.ingester as any,
    deps.featurePipeline as any,
    deps.outcomeLabeller as any,
    deps.performanceAggregator as any,
    deps.indicatorPerfCalculator as any,
    deps.strategyPerfRepo as any,
    deps.indicatorPerfRepo as any,
    deps.regimePriorUpdater as any,
    deps.regimePerformanceRepo as any,
    deps.modelTrainer as any,
    deps.modelRegistry as any,
    deps.injectionOrchestrator as any,
    deps.logger as any
  );
}

describe('LearningEngine.triggerEodRun', () => {
  it('throws ConcurrentTrainingRunError when a run is already in progress', async () => {
    const deps = makeDeps();
    deps.trainingRunRepo.findInProgress.mockResolvedValue({
      training_run_id: 'existing-run',
      status: 'INGESTING',
    });
    const engine = makeEngine(deps);

    await expect(
      engine.triggerEodRun('strat-1', new Date(), 'PG_CRON')
    ).rejects.toBeInstanceOf(ConcurrentTrainingRunError);
  });

  it('creates a TrainingRun and returns training_run_id immediately (non-blocking)', async () => {
    const deps = makeDeps();
    // Make ingestBatch hang so we can prove triggerEodRun doesn't await the pipeline.
    let resolveIngest: (v: any[]) => void = () => {};
    deps.ingester.ingestBatch.mockImplementation(
      () => new Promise((resolve) => (resolveIngest = resolve))
    );
    const engine = makeEngine(deps);

    const training_run_id = await engine.triggerEodRun('strat-1', new Date(), 'PG_CRON');

    expect(typeof training_run_id).toBe('string');
    expect(deps.trainingRunRepo.save).toHaveBeenCalledTimes(1);
    // Pipeline stage transitions haven't happened yet — proves non-blocking.
    expect(deps.trainingRunRepo.updateStatus).not.toHaveBeenCalledWith(
      training_run_id,
      'TRAINED',
      expect.anything()
    );
    resolveIngest([]);
  });

  it('calls pipeline stages in the correct order', async () => {
    const deps = makeDeps();
    const engine = makeEngine(deps);
    const training_run_id = await engine.triggerEodRun('strat-1', new Date(), 'PG_CRON');

    // Flush the fire-and-forget pipeline microtask queue.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const statusCalls = deps.trainingRunRepo.updateStatus.mock.calls.map((c) => c[1]);
    const order = ['INGESTING', 'FEATURE_EXTRACTING', 'OUTCOME_LABELLING', 'AGGREGATING', 'TRAINING'];
    let lastIdx = -1;
    for (const status of order) {
      const idx = statusCalls.indexOf(status);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });
});

describe('LearningEngine.injectIntoPhase5', () => {
  it('is a no-op when findLatestCompleted returns TRAINED_UNRELIABLE', async () => {
    const deps = makeDeps();
    deps.trainingRunRepo.findLatestCompleted.mockResolvedValue({
      training_run_id: 'run-1',
      status: 'TRAINED_UNRELIABLE',
    });
    const engine = makeEngine(deps);

    await engine.injectIntoPhase5('strat-1', { setQualityModel: jest.fn() }, { setWinRateProvider: jest.fn() });

    expect(deps.injectionOrchestrator.assemble).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('is a no-op when no completed run exists', async () => {
    const deps = makeDeps();
    deps.trainingRunRepo.findLatestCompleted.mockResolvedValue(null);
    const engine = makeEngine(deps);

    await engine.injectIntoPhase5('strat-1', { setQualityModel: jest.fn() }, { setWinRateProvider: jest.fn() });

    expect(deps.injectionOrchestrator.assemble).not.toHaveBeenCalled();
  });
});

describe('LearningEngine.hasReadyModel', () => {
  it('returns false when no CURRENT versions exist', async () => {
    const deps = makeDeps();
    deps.modelRegistry.getAllCurrentForRun.mockResolvedValue([]);
    const engine = makeEngine(deps);

    await expect(engine.hasReadyModel('strat-1')).resolves.toBe(false);
  });

  it('returns true when a CURRENT reliable version exists', async () => {
    const deps = makeDeps();
    deps.modelRegistry.getAllCurrentForRun.mockResolvedValue([{ is_ready: true }]);
    const engine = makeEngine(deps);

    await expect(engine.hasReadyModel('strat-1')).resolves.toBe(true);
  });
});
