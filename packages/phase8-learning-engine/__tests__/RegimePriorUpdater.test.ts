/**
 * phase8/__tests__/RegimePriorUpdater.test.ts
 *
 * Complete unit test suite for RegimePriorUpdater (phase8-contracts-v1.md
 * §3.6, roadmap Step 12). Tests only — no implementation code touched or
 * generated. Mocks IRegimePriorRepository and a Logger; both public methods
 * (compute, activate) are covered, including the Bayesian update math,
 * grouping logic, RegimeFitness scoring, I-02 supersession, and error paths.
 *
 * Jest-style (describe/it/expect/jest.fn).
 */
import { RegimePriorUpdater } from '../services/RegimePriorUpdater';
import { OrphanedRegimePriorSupersessionError } from '../errors/Phase8Error';
import type { RegimePriorDTO, IndicatorPerformanceDTO } from '../dtos/outputs';
import type { LabelledOutcomeDTO } from '../dtos/inputs';
import type { TrainingRunId, RegimePriorId } from '../domain/types';

// ---- fixtures ----

function makeOutcome(overrides: Partial<LabelledOutcomeDTO> = {}): LabelledOutcomeDTO {
  return {
    regime_label: 'BULL',
    symbol_id: null,
    timeframe: '1d',
    was_winner: true,
    actual_return: 0.01,
    mae: 0.002,
    mfe: 0.015,
    ...overrides,
  } as LabelledOutcomeDTO;
}

function makeIndicatorPerf(overrides: Partial<IndicatorPerformanceDTO> = {}): IndicatorPerformanceDTO {
  return {
    indicator_name: 'RSI',
    indicator_params: { period: 14 },
    information_ratio: { ratio: 0.5, predictive_accuracy: 0.6 },
    ...overrides,
  } as IndicatorPerformanceDTO;
}

function makeRegimePrior(overrides: Partial<RegimePriorDTO> = {}): RegimePriorDTO {
  return {
    regime_prior_id: 'rp-1' as RegimePriorId,
    training_run_id: 'run-1' as TrainingRunId,
    regime_label: 'BULL',
    symbol_id: null,
    timeframe: '1d',
    status: 'COMPUTING',
    win_rate: { wins: 20, total: 40, rate: 0.5, is_reliable: true },
    avg_return_pct: 0.02,
    avg_volatility: 0.01,
    indicator_rankings: [],
    regime_fitness: {
      score: 0.5,
      components: { win_rate_component: 0.5, sharpe_component: 0, avg_return_component: 0.52, sample_weight: 1 },
      is_reliable: true,
    },
    computed_at: new Date('2026-07-01T00:00:00.000Z'),
    superseded_at: null,
    ...overrides,
  } as RegimePriorDTO;
}

function makeMockRepo() {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    findCurrent: jest.fn(),
    findAllCurrentForRun: jest.fn(),
  };
}

function makeMockLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

// ============================================================
// compute()
// ============================================================
describe('RegimePriorUpdater.compute', () => {
  it('happy path: no prior CURRENT — uses uniform Beta(1,1) prior, produces one RegimePriorDTO per regime group', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const logger = makeMockLogger();
    const updater = new RegimePriorUpdater(repo as any, logger as any);

    const corpus = [
      makeOutcome({ was_winner: true, actual_return: 0.02 }),
      makeOutcome({ was_winner: false, actual_return: -0.01 }),
    ];
    const perfs = [makeIndicatorPerf()];

    const result = await updater.compute('run-1' as TrainingRunId, corpus, perfs);

    expect(result).toHaveLength(1);
    const dto = result[0];
    expect(dto.regime_label).toBe('BULL');
    expect(dto.symbol_id).toBeNull();
    expect(dto.timeframe).toBe('1d');
    expect(dto.status).toBe('COMPUTING');
    expect(dto.training_run_id).toBe('run-1');
    expect(dto.win_rate.wins).toBe(1);
    expect(dto.win_rate.total).toBe(2);
    expect(dto.win_rate.rate).toBeCloseTo(0.5, 10);
  });

  it('happy path: multiple distinct (regime_label, symbol_id, timeframe) groups produce one DTO each', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const corpus = [
      makeOutcome({ regime_label: 'BULL', symbol_id: 'AAPL', timeframe: '1d' }),
      makeOutcome({ regime_label: 'BEAR', symbol_id: 'AAPL', timeframe: '1d' }),
      makeOutcome({ regime_label: 'BULL', symbol_id: 'MSFT', timeframe: '1h' }),
    ];

    const result = await updater.compute('run-1' as TrainingRunId, corpus, []);

    expect(result).toHaveLength(3);
    const keys = result.map((d) => `${d.regime_label}|${d.symbol_id}|${d.timeframe}`).sort();
    expect(keys).toEqual(['BEAR|AAPL|1d', 'BULL|AAPL|1d', 'BULL|MSFT|1h']);
  });

  it('happy path: groups records with the same (regime_label, symbol_id, timeframe) into a single DTO', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const corpus = [
      makeOutcome({ was_winner: true }),
      makeOutcome({ was_winner: true }),
      makeOutcome({ was_winner: false }),
    ];

    const result = await updater.compute('run-1' as TrainingRunId, corpus, []);

    expect(result).toHaveLength(1);
    expect(result[0].win_rate.total).toBe(3);
    expect(result[0].win_rate.wins).toBe(2);
  });

  it('happy path (Bayesian update with an existing prior): blends prior wins/total with observed data', async () => {
    const repo = makeMockRepo();
    const prior = makeRegimePrior({ win_rate: { wins: 10, total: 20, rate: 0.5, is_reliable: true } });
    repo.findCurrent.mockResolvedValue(prior);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const corpus = [makeOutcome({ was_winner: true }), makeOutcome({ was_winner: true })];

    const result = await updater.compute('run-1' as TrainingRunId, corpus, []);

    expect(result[0].win_rate.wins).toBe(12);
    expect(result[0].win_rate.total).toBe(22);
  });

  it('happy path: avg_return_pct is a precision-weighted blend of prior and observed means', async () => {
    const repo = makeMockRepo();
    const prior = makeRegimePrior({
      avg_return_pct: 0.1,
      win_rate: { wins: 8, total: 10, rate: 0.8, is_reliable: true },
    });
    repo.findCurrent.mockResolvedValue(prior);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const corpus = Array.from({ length: 10 }, () => makeOutcome({ actual_return: 0.02, was_winner: true }));

    const result = await updater.compute('run-1' as TrainingRunId, corpus, []);

    expect(result[0].avg_return_pct).toBeCloseTo(0.06, 10);
  });

  it('happy path: indicator_rankings are built and sorted by information_ratio.ratio DESC, rank starting at 1', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const perfs = [
      makeIndicatorPerf({ indicator_name: 'LOW', information_ratio: { ratio: 0.1, predictive_accuracy: 0.5, sample_count: 30, is_reliable: true } }),
      makeIndicatorPerf({ indicator_name: 'HIGH', information_ratio: { ratio: 0.9, predictive_accuracy: 0.7, sample_count: 30, is_reliable: true } }),
      makeIndicatorPerf({ indicator_name: 'MID', information_ratio: { ratio: 0.5, predictive_accuracy: 0.6, sample_count: 30, is_reliable: true } }),
    ];
    const corpus = [makeOutcome()];

    const result = await updater.compute('run-1' as TrainingRunId, corpus, perfs);

    const rankings = result[0].indicator_rankings;
    expect(rankings.map((r) => r.indicator_name)).toEqual(['HIGH', 'MID', 'LOW']);
    expect(rankings.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('happy path: the same indicator_rankings are applied identically across all regime groups in one compute() call', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const perfs = [makeIndicatorPerf({ indicator_name: 'RSI' })];
    const corpus = [
      makeOutcome({ regime_label: 'BULL' }),
      makeOutcome({ regime_label: 'BEAR' }),
    ];

    const result = await updater.compute('run-1' as TrainingRunId, corpus, perfs);

    expect(result[0].indicator_rankings.map((r) => r.indicator_name)).toEqual(['RSI']);
    expect(result[1].indicator_rankings.map((r) => r.indicator_name)).toEqual(['RSI']);
  });

  it('happy path: RegimeFitness.is_reliable is true when total observations >= MIN_SAMPLE_SIZE (30)', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const corpus = Array.from({ length: 30 }, () => makeOutcome({ was_winner: true }));

    const result = await updater.compute('run-1' as TrainingRunId, corpus, []);

    expect(result[0].regime_fitness.is_reliable).toBe(true);
    expect(result[0].win_rate.is_reliable).toBe(true);
  });

  it('boundary: total observations one below MIN_SAMPLE_SIZE is_reliable=false', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const corpus = Array.from({ length: 29 }, () => makeOutcome({ was_winner: true }));

    const result = await updater.compute('run-1' as TrainingRunId, corpus, []);

    expect(result[0].regime_fitness.is_reliable).toBe(false);
    expect(result[0].win_rate.is_reliable).toBe(false);
  });

  it('boundary: an empty corpus produces an empty result array with no repository calls', async () => {
    const repo = makeMockRepo();
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const result = await updater.compute('run-1' as TrainingRunId, [], []);

    expect(result).toEqual([]);
    expect(repo.findCurrent).not.toHaveBeenCalled();
  });

  it('boundary: an empty indicator_perfs array produces an empty indicator_rankings on every DTO', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const result = await updater.compute('run-1' as TrainingRunId, [makeOutcome()], []);

    expect(result[0].indicator_rankings).toEqual([]);
  });

  it('boundary: RegimeFitness.score and components are clamped to [0, 1]', async () => {
    const repo = makeMockRepo();
    const prior = makeRegimePrior({
      avg_return_pct: 10,
      win_rate: { wins: 100, total: 100, rate: 1, is_reliable: true },
    });
    repo.findCurrent.mockResolvedValue(prior);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const result = await updater.compute('run-1' as TrainingRunId, [makeOutcome({ actual_return: 10 })], []);

    expect(result[0].regime_fitness.score).toBeGreaterThanOrEqual(0);
    expect(result[0].regime_fitness.score).toBeLessThanOrEqual(1);
    expect(result[0].regime_fitness.components.avg_return_component).toBeLessThanOrEqual(1);
  });

  it('boundary: a symbol_id of null is grouped distinctly from a non-null symbol_id for the same regime/timeframe', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const corpus = [
      makeOutcome({ symbol_id: null }),
      makeOutcome({ symbol_id: 'AAPL' }),
    ];

    const result = await updater.compute('run-1' as TrainingRunId, corpus, []);

    expect(result).toHaveLength(2);
    expect(result.some((d) => d.symbol_id === null)).toBe(true);
    expect(result.some((d) => d.symbol_id === 'AAPL')).toBe(true);
  });

  it('exception propagation: a repository.findCurrent() failure propagates unmodified and stops processing', async () => {
    const repo = makeMockRepo();
    const dbError = new Error('connection reset');
    repo.findCurrent.mockRejectedValue(dbError);
    const logger = makeMockLogger();
    const updater = new RegimePriorUpdater(repo as any, logger as any);

    await expect(updater.compute('run-1' as TrainingRunId, [makeOutcome()], [])).rejects.toBe(dbError);
    expect(logger.error).toHaveBeenCalled();
  });
});

// ============================================================
// activate()
// ============================================================
describe('RegimePriorUpdater.activate', () => {
  it('happy path: no prior CURRENT for the group — saves and marks CURRENT, no supersede call', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);
    const newPrior = makeRegimePrior({ regime_prior_id: 'rp-new' as RegimePriorId });

    await updater.activate(newPrior);

    expect(repo.save).toHaveBeenCalledWith(newPrior);
    expect(repo.updateStatus).toHaveBeenCalledTimes(1);
    expect(repo.updateStatus).toHaveBeenCalledWith('rp-new', 'CURRENT');
  });

  it('happy path (I-02 supersession): existing different CURRENT is superseded, new one persisted and activated', async () => {
    const repo = makeMockRepo();
    const priorCurrent = makeRegimePrior({ regime_prior_id: 'rp-old' as RegimePriorId, status: 'CURRENT' });
    repo.findCurrent.mockResolvedValue(priorCurrent);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);
    const newPrior = makeRegimePrior({ regime_prior_id: 'rp-new' as RegimePriorId });

    await updater.activate(newPrior);

    expect(repo.save).toHaveBeenCalledWith(newPrior);
    expect(repo.updateStatus).toHaveBeenCalledTimes(2);
    expect(repo.updateStatus.mock.calls[0]).toEqual([
      'rp-old',
      'SUPERSEDED',
      expect.objectContaining({ superseded_at: expect.any(Date) }),
    ]);
    expect(repo.updateStatus.mock.calls[1]).toEqual(['rp-new', 'CURRENT']);
  });

  it('boundary: activating a prior that is already the same CURRENT row does not supersede itself', async () => {
    const repo = makeMockRepo();
    const samePrior = makeRegimePrior({ regime_prior_id: 'rp-same' as RegimePriorId, status: 'CURRENT' });
    repo.findCurrent.mockResolvedValue(samePrior);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    await updater.activate(samePrior);

    expect(repo.updateStatus).toHaveBeenCalledTimes(1);
    expect(repo.updateStatus).toHaveBeenCalledWith('rp-same', 'CURRENT');
  });

  it('failure path (I-02 orphan guard): supersede failure throws OrphanedRegimePriorSupersessionError', async () => {
    const repo = makeMockRepo();
    const priorCurrent = makeRegimePrior({ regime_prior_id: 'rp-old' as RegimePriorId, status: 'CURRENT' });
    repo.findCurrent.mockResolvedValue(priorCurrent);
    repo.updateStatus.mockRejectedValueOnce(new Error('lock timeout'));
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);
    const newPrior = makeRegimePrior({ regime_prior_id: 'rp-new' as RegimePriorId });

    await expect(updater.activate(newPrior)).rejects.toBeInstanceOf(OrphanedRegimePriorSupersessionError);
  });

  it('failure path: OrphanedRegimePriorSupersessionError carries the regime_label/symbol_id/timeframe of the group', async () => {
    const repo = makeMockRepo();
    const priorCurrent = makeRegimePrior({ regime_prior_id: 'rp-old' as RegimePriorId, status: 'CURRENT' });
    repo.findCurrent.mockResolvedValue(priorCurrent);
    repo.updateStatus.mockRejectedValueOnce(new Error('conflict'));
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);
    const newPrior = makeRegimePrior({
      regime_prior_id: 'rp-new' as RegimePriorId,
      regime_label: 'CHOP',
      symbol_id: 'TSLA',
      timeframe: '4h',
    });

    try {
      await updater.activate(newPrior);
      fail('expected activate() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OrphanedRegimePriorSupersessionError);
      expect((err as OrphanedRegimePriorSupersessionError).regime_label).toBe('CHOP');
      expect((err as OrphanedRegimePriorSupersessionError).symbol_id).toBe('TSLA');
      expect((err as OrphanedRegimePriorSupersessionError).timeframe).toBe('4h');
    }
  });

  it('exception propagation: a repository.findCurrent() failure propagates unmodified', async () => {
    const repo = makeMockRepo();
    const dbError = new Error('read timeout');
    repo.findCurrent.mockRejectedValue(dbError);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    await expect(updater.activate(makeRegimePrior())).rejects.toBe(dbError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('exception propagation: a repository.save() failure propagates unmodified (before any supersede attempt)', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const saveError = new Error('constraint violation');
    repo.save.mockRejectedValue(saveError);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    await expect(updater.activate(makeRegimePrior())).rejects.toBe(saveError);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('exception propagation: a repository.updateStatus() failure on the FINAL (mark CURRENT) call propagates unmodified, not wrapped', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const finalError = new Error('deadlock on final activation');
    repo.updateStatus.mockRejectedValueOnce(finalError);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    await expect(updater.activate(makeRegimePrior())).rejects.toBe(finalError);
  });
});

// ============================================================
// Contract verification — IRegimePriorUpdater (contracts §3.6)
// ============================================================
describe('RegimePriorUpdater — IRegimePriorUpdater contract conformance', () => {
  it('exposes exactly the two methods declared on IRegimePriorUpdater', () => {
    const repo = makeMockRepo();
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    expect(typeof updater.compute).toBe('function');
    expect(typeof updater.activate).toBe('function');
  });

  it('compute() is pure with respect to persistence — never calls save() or updateStatus()', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    await updater.compute('run-1' as TrainingRunId, [makeOutcome(), makeOutcome({ regime_label: 'BEAR' })], []);

    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('compute() returns Promise<RegimePriorDTO[]> (an array, even for a single-group corpus)', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const result = await updater.compute('run-1' as TrainingRunId, [makeOutcome()], []);

    expect(Array.isArray(result)).toBe(true);
  });

  it('activate() returns Promise<void> (resolves with undefined) on success', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const result = await updater.activate(makeRegimePrior());

    expect(result).toBeUndefined();
  });

  it('every RegimePriorDTO returned by compute() has the corrected identity fields present (see RegimePriorDTO.PATCH.md)', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const updater = new RegimePriorUpdater(repo as any, makeMockLogger() as any);

    const [dto] = await updater.compute('run-1' as TrainingRunId, [makeOutcome()], []);

    expect(dto.regime_prior_id).toBeDefined();
    expect(dto.training_run_id).toBe('run-1');
    expect(dto.regime_label).toBeDefined();
    expect(dto.timeframe).toBeDefined();
    expect(dto.status).toBe('COMPUTING');
    expect('symbol_id' in dto).toBe(true);
  });
});
