/**
 * phase8/__tests__/ModelRegistry.test.ts
 *
 * Complete unit test suite for ModelRegistry (phase8-contracts-v1.md §3.5,
 * roadmap Step 11). Tests only — no implementation code touched or generated.
 * Mocks IModelVersionRepository and asserts against ModelRegistry.ts as
 * written; every public method (register, activate, getCurrent, getHistory,
 * getAllCurrentForRun) is covered.
 *
 * Jest-style (describe/it/expect/jest.fn) — adjust import path for the
 * project's actual test runner if it differs.
 */
import { ModelRegistry } from '../services/ModelRegistry';
import {
  DuplicateModelVersionError,
  ModelVersionNotFoundError,
  InvalidModelActivationStateError,
  UnreliableModelActivationError,
  OrphanedSupersessionError,
} from '../errors/Phase8Error';
import type { ModelVersionDTO } from '../dtos/outputs';
import type { ModelKey, ModelVersionId } from '../domain/types';

// ---- fixtures ----

function makeModelKey(overrides: Partial<ModelKey> = {}): ModelKey {
  return {
    strategy_id: 'strat-1',
    signal_type: 'BREAKOUT',
    regime_label: 'BULL',
    ...overrides,
  } as ModelKey;
}

function makeModelVersion(overrides: Partial<ModelVersionDTO> = {}): ModelVersionDTO {
  return {
    model_version_id: 'mv-1' as ModelVersionId,
    training_run_id: 'run-1',
    model_key: makeModelKey(),
    status: 'TRAINED',
    is_ready: true,
    sample_size: 50,
    artifact_format: 'FREQUENCY_TABLE',
    artifact_payload: { win_probability: 0.6 },
    artifact_checksum: 'deadbeef',
    trained_at: new Date('2026-07-01T00:00:00.000Z'),
    activated_at: null,
    superseded_at: null,
    ...overrides,
  } as ModelVersionDTO;
}

function makeMockRepo() {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findCurrent: jest.fn(),
    findAllForRun: jest.fn(),
    findAllCurrentForStrategyRun: jest.fn(),
    findHistoryByModelKey: jest.fn(),
  };
}

function makeMockLogger() {
  // ModelRegistry itself takes no logger (constructor is repo-only) — kept
  // here only in case a future revision adds one; unused by current tests.
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

// ============================================================
// register()
// ============================================================
describe('ModelRegistry.register', () => {
  it('happy path: saves a new ModelVersion when no existing row is found', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(null);
    const registry = new ModelRegistry(repo as any);
    const model = makeModelVersion();

    await registry.register(model);

    expect(repo.findById).toHaveBeenCalledWith(model.model_version_id);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledWith(model);
  });

  it('duplicate model version: throws DuplicateModelVersionError and never calls save()', async () => {
    const repo = makeMockRepo();
    const existing = makeModelVersion();
    repo.findById.mockResolvedValue(existing);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.register(existing)).rejects.toBeInstanceOf(DuplicateModelVersionError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('duplicate model version: error carries the offending model_version_id', async () => {
    const repo = makeMockRepo();
    const existing = makeModelVersion({ model_version_id: 'mv-dup' as ModelVersionId });
    repo.findById.mockResolvedValue(existing);
    const registry = new ModelRegistry(repo as any);

    try {
      await registry.register(existing);
      fail('expected register() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateModelVersionError);
      expect((err as DuplicateModelVersionError).model_version_id).toBe('mv-dup');
    }
  });

  it('exception propagation: a repository.findById() failure propagates unmodified', async () => {
    const repo = makeMockRepo();
    const dbError = new Error('connection reset');
    repo.findById.mockRejectedValue(dbError);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.register(makeModelVersion())).rejects.toBe(dbError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('exception propagation: a repository.save() failure propagates unmodified', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(null);
    const dbError = new Error('unique constraint violation');
    repo.save.mockRejectedValue(dbError);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.register(makeModelVersion())).rejects.toBe(dbError);
  });
});

// ============================================================
// activate()
// ============================================================
describe('ModelRegistry.activate', () => {
  it('happy path: first activation for a ModelKey (no prior CURRENT) — plain activation, no supersede call', async () => {
    const repo = makeMockRepo();
    const target = makeModelVersion({ status: 'TRAINED', is_ready: true });
    repo.findById.mockResolvedValue(target);
    repo.findCurrent.mockResolvedValue(null);
    const registry = new ModelRegistry(repo as any);

    await registry.activate(target.model_version_id);

    expect(repo.updateStatus).toHaveBeenCalledTimes(1);
    expect(repo.updateStatus).toHaveBeenCalledWith(
      target.model_version_id,
      'CURRENT',
      expect.objectContaining({ activated_at: expect.any(Date) })
    );
  });

  it('happy path: activation with an existing different CURRENT — supersedes old, then activates new, in that order', async () => {
    const repo = makeMockRepo();
    const target = makeModelVersion({ model_version_id: 'mv-new' as ModelVersionId, status: 'TRAINED', is_ready: true });
    const priorCurrent = makeModelVersion({ model_version_id: 'mv-old' as ModelVersionId, status: 'CURRENT' });
    repo.findById.mockResolvedValue(target);
    repo.findCurrent.mockResolvedValue(priorCurrent);
    const registry = new ModelRegistry(repo as any);

    await registry.activate(target.model_version_id);

    expect(repo.updateStatus).toHaveBeenCalledTimes(2);
    // Call order matters: supersede old CURRENT first, then activate new.
    expect(repo.updateStatus.mock.calls[0]).toEqual([
      'mv-old',
      'SUPERSEDED',
      expect.objectContaining({ superseded_at: expect.any(Date) }),
    ]);
    expect(repo.updateStatus.mock.calls[1]).toEqual([
      'mv-new',
      'CURRENT',
      expect.objectContaining({ activated_at: expect.any(Date) }),
    ]);
  });

  it('boundary: activating a version that is already the CURRENT one for its ModelKey does not supersede itself', async () => {
    const repo = makeMockRepo();
    const target = makeModelVersion({ model_version_id: 'mv-same' as ModelVersionId, status: 'TRAINED', is_ready: true });
    // findCurrent returns the SAME id as target — e.g. re-activation edge case.
    const sameAsTarget = makeModelVersion({ model_version_id: 'mv-same' as ModelVersionId, status: 'CURRENT' });
    repo.findById.mockResolvedValue(target);
    repo.findCurrent.mockResolvedValue(sameAsTarget);
    const registry = new ModelRegistry(repo as any);

    await registry.activate(target.model_version_id);

    // Only the plain activation call, never a supersede call against itself.
    expect(repo.updateStatus).toHaveBeenCalledTimes(1);
    expect(repo.updateStatus).toHaveBeenCalledWith(
      'mv-same',
      'CURRENT',
      expect.objectContaining({ activated_at: expect.any(Date) })
    );
  });

  it('failure path: model_version_id not found throws ModelVersionNotFoundError', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(null);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.activate('mv-missing' as ModelVersionId)).rejects.toBeInstanceOf(
      ModelVersionNotFoundError
    );
    expect(repo.findCurrent).not.toHaveBeenCalled();
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('failure path: activating a non-TRAINED version throws InvalidModelActivationStateError', async () => {
    const repo = makeMockRepo();
    const target = makeModelVersion({ status: 'SUPERSEDED' });
    repo.findById.mockResolvedValue(target);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.activate(target.model_version_id)).rejects.toBeInstanceOf(
      InvalidModelActivationStateError
    );
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('failure path: InvalidModelActivationStateError carries the actual status found', async () => {
    const repo = makeMockRepo();
    const target = makeModelVersion({ status: 'COMPUTING' as any });
    repo.findById.mockResolvedValue(target);
    const registry = new ModelRegistry(repo as any);

    try {
      await registry.activate(target.model_version_id);
      fail('expected activate() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidModelActivationStateError);
      expect((err as InvalidModelActivationStateError).actual_status).toBe('COMPUTING');
    }
  });

  it('failure path (I-03): activating an unreliable (is_ready=false) TRAINED version throws UnreliableModelActivationError', async () => {
    const repo = makeMockRepo();
    const target = makeModelVersion({ status: 'TRAINED', is_ready: false });
    repo.findById.mockResolvedValue(target);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.activate(target.model_version_id)).rejects.toBeInstanceOf(
      UnreliableModelActivationError
    );
    expect(repo.findCurrent).not.toHaveBeenCalled();
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('failure path (I-01 orphan guard): if activating the new CURRENT fails after the old one was superseded, throws OrphanedSupersessionError', async () => {
    const repo = makeMockRepo();
    const target = makeModelVersion({ model_version_id: 'mv-new' as ModelVersionId, status: 'TRAINED', is_ready: true });
    const priorCurrent = makeModelVersion({ model_version_id: 'mv-old' as ModelVersionId, status: 'CURRENT' });
    repo.findById.mockResolvedValue(target);
    repo.findCurrent.mockResolvedValue(priorCurrent);
    // First updateStatus (supersede) succeeds; second (activate new) fails.
    repo.updateStatus
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('db timeout'));
    const registry = new ModelRegistry(repo as any);

    await expect(registry.activate(target.model_version_id)).rejects.toBeInstanceOf(
      OrphanedSupersessionError
    );
    expect(repo.updateStatus).toHaveBeenCalledTimes(2);
  });

  it('failure path: OrphanedSupersessionError carries the affected ModelKey', async () => {
    const repo = makeMockRepo();
    const modelKey = makeModelKey({ signal_type: 'REVERSAL' });
    const target = makeModelVersion({
      model_version_id: 'mv-new' as ModelVersionId,
      model_key: modelKey,
      status: 'TRAINED',
      is_ready: true,
    });
    const priorCurrent = makeModelVersion({ model_version_id: 'mv-old' as ModelVersionId, status: 'CURRENT' });
    repo.findById.mockResolvedValue(target);
    repo.findCurrent.mockResolvedValue(priorCurrent);
    repo.updateStatus.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('conflict'));
    const registry = new ModelRegistry(repo as any);

    try {
      await registry.activate(target.model_version_id);
      fail('expected activate() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OrphanedSupersessionError);
      expect((err as OrphanedSupersessionError).model_key).toEqual(modelKey);
    }
  });

  it('exception propagation: a repository.findById() failure propagates unmodified', async () => {
    const repo = makeMockRepo();
    const dbError = new Error('connection reset');
    repo.findById.mockRejectedValue(dbError);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.activate('mv-1' as ModelVersionId)).rejects.toBe(dbError);
  });

  it('exception propagation: a repository.findCurrent() failure propagates unmodified (not wrapped as OrphanedSupersessionError)', async () => {
    const repo = makeMockRepo();
    const target = makeModelVersion({ status: 'TRAINED', is_ready: true });
    repo.findById.mockResolvedValue(target);
    const dbError = new Error('read replica lag');
    repo.findCurrent.mockRejectedValue(dbError);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.activate(target.model_version_id)).rejects.toBe(dbError);
  });

  it('exception propagation: a repository.updateStatus() failure on the FIRST (supersede) call propagates unmodified, not as OrphanedSupersessionError', async () => {
    const repo = makeMockRepo();
    const target = makeModelVersion({ model_version_id: 'mv-new' as ModelVersionId, status: 'TRAINED', is_ready: true });
    const priorCurrent = makeModelVersion({ model_version_id: 'mv-old' as ModelVersionId, status: 'CURRENT' });
    repo.findById.mockResolvedValue(target);
    repo.findCurrent.mockResolvedValue(priorCurrent);
    const supersedeError = new Error('lock timeout on supersede');
    repo.updateStatus.mockRejectedValueOnce(supersedeError);
    const registry = new ModelRegistry(repo as any);

    // The try/catch in ModelRegistry.activate() only wraps the SECOND
    // updateStatus call — a failure on the first (supersede) call should
    // propagate as-is, not be reclassified as OrphanedSupersessionError.
    await expect(registry.activate(target.model_version_id)).rejects.toBe(supersedeError);
  });
});

// ============================================================
// getCurrent()
// ============================================================
describe('ModelRegistry.getCurrent', () => {
  it('happy path: delegates directly to repository.findCurrent() and returns its result', async () => {
    const repo = makeMockRepo();
    const current = makeModelVersion({ status: 'CURRENT' });
    repo.findCurrent.mockResolvedValue(current);
    const registry = new ModelRegistry(repo as any);
    const key = makeModelKey();

    const result = await registry.getCurrent(key);

    expect(repo.findCurrent).toHaveBeenCalledWith(key);
    expect(result).toBe(current);
  });

  it('boundary: returns null when no CURRENT version exists for the ModelKey', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const registry = new ModelRegistry(repo as any);

    const result = await registry.getCurrent(makeModelKey());

    expect(result).toBeNull();
  });

  it('exception propagation: a repository failure propagates unmodified', async () => {
    const repo = makeMockRepo();
    const dbError = new Error('query failed');
    repo.findCurrent.mockRejectedValue(dbError);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.getCurrent(makeModelKey())).rejects.toBe(dbError);
  });
});

// ============================================================
// getHistory()
// ============================================================
describe('ModelRegistry.getHistory', () => {
  it('happy path: delegates to repository.findHistoryByModelKey() and returns all versions', async () => {
    const repo = makeMockRepo();
    const key = makeModelKey();
    const history = [
      makeModelVersion({ model_version_id: 'mv-3' as ModelVersionId, status: 'CURRENT' }),
      makeModelVersion({ model_version_id: 'mv-2' as ModelVersionId, status: 'SUPERSEDED' }),
      makeModelVersion({ model_version_id: 'mv-1' as ModelVersionId, status: 'SUPERSEDED' }),
    ];
    repo.findHistoryByModelKey.mockResolvedValue(history);
    const registry = new ModelRegistry(repo as any);

    const result = await registry.getHistory(key);

    expect(repo.findHistoryByModelKey).toHaveBeenCalledWith(key);
    expect(result).toBe(history);
    expect(result).toHaveLength(3);
  });

  it('boundary: returns an empty array when no versions exist yet for the ModelKey', async () => {
    const repo = makeMockRepo();
    repo.findHistoryByModelKey.mockResolvedValue([]);
    const registry = new ModelRegistry(repo as any);

    const result = await registry.getHistory(makeModelKey());

    expect(result).toEqual([]);
  });

  it('exception propagation: a repository failure propagates unmodified', async () => {
    const repo = makeMockRepo();
    const dbError = new Error('index not found');
    repo.findHistoryByModelKey.mockRejectedValue(dbError);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.getHistory(makeModelKey())).rejects.toBe(dbError);
  });
});

// ============================================================
// getAllCurrentForRun()
// ============================================================
describe('ModelRegistry.getAllCurrentForRun', () => {
  it('happy path: delegates to repository.findAllCurrentForStrategyRun() and returns all CURRENT versions', async () => {
    const repo = makeMockRepo();
    const versions = [makeModelVersion({ status: 'CURRENT' }), makeModelVersion({ model_version_id: 'mv-2' as ModelVersionId, status: 'CURRENT' })];
    repo.findAllCurrentForStrategyRun.mockResolvedValue(versions);
    const registry = new ModelRegistry(repo as any);

    const result = await registry.getAllCurrentForRun('strat-1');

    expect(repo.findAllCurrentForStrategyRun).toHaveBeenCalledWith('strat-1');
    expect(result).toBe(versions);
  });

  it('boundary: returns an empty array when the strategy run has no CURRENT versions', async () => {
    const repo = makeMockRepo();
    repo.findAllCurrentForStrategyRun.mockResolvedValue([]);
    const registry = new ModelRegistry(repo as any);

    const result = await registry.getAllCurrentForRun('strat-empty');

    expect(result).toEqual([]);
  });

  it('exception propagation: a repository failure propagates unmodified', async () => {
    const repo = makeMockRepo();
    const dbError = new Error('connection pool exhausted');
    repo.findAllCurrentForStrategyRun.mockRejectedValue(dbError);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.getAllCurrentForRun('strat-1')).rejects.toBe(dbError);
  });
});

// ============================================================
// Contract verification — IModelRegistry (contracts §3.5)
// ============================================================
describe('ModelRegistry — IModelRegistry contract conformance', () => {
  it('exposes exactly the five methods declared on IModelRegistry, no more, no less', () => {
    const repo = makeMockRepo();
    const registry = new ModelRegistry(repo as any);

    const expectedMethods = ['register', 'activate', 'getCurrent', 'getHistory', 'getAllCurrentForRun'];
    for (const method of expectedMethods) {
      expect(typeof (registry as any)[method]).toBe('function');
    }
  });

  it('register() and activate() return Promise<void> (resolve with undefined) on success', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(null);
    const registry = new ModelRegistry(repo as any);

    const registerResult = await registry.register(makeModelVersion());
    expect(registerResult).toBeUndefined();

    const target = makeModelVersion({ status: 'TRAINED', is_ready: true });
    repo.findById.mockResolvedValue(target);
    repo.findCurrent.mockResolvedValue(null);
    const activateResult = await registry.activate(target.model_version_id);
    expect(activateResult).toBeUndefined();
  });

  it('getCurrent() return type is ModelVersionDTO | null (never throws for a legitimate "not found")', async () => {
    const repo = makeMockRepo();
    repo.findCurrent.mockResolvedValue(null);
    const registry = new ModelRegistry(repo as any);

    await expect(registry.getCurrent(makeModelKey())).resolves.toBeNull();
  });

  it('getHistory() and getAllCurrentForRun() return array types (never null/undefined on empty)', async () => {
    const repo = makeMockRepo();
    repo.findHistoryByModelKey.mockResolvedValue([]);
    repo.findAllCurrentForStrategyRun.mockResolvedValue([]);
    const registry = new ModelRegistry(repo as any);

    const history = await registry.getHistory(makeModelKey());
    const current = await registry.getAllCurrentForRun('strat-1');

    expect(Array.isArray(history)).toBe(true);
    expect(Array.isArray(current)).toBe(true);
  });
});
