/**
 * phase8/__tests__/InjectionOrchestrator.test.ts
 *
 * Complete unit test suite for InjectionOrchestrator (phase8-contracts-v1.md
 * §3.8, roadmap Step 14). Tests only — no implementation code touched or
 * generated. Mocks IModelRegistry, IModelArtifactLoader, ISystemStateReader,
 * and a Logger; both public methods (assemble, deliver) are covered,
 * including the KillSwitch gate, per-version timeout, checksum/format/
 * not-found skip-and-continue behavior, and partial-injection failure.
 *
 * Timeout tests use jest fake timers rather than waiting on real wall-clock
 * time — INJECTION_TIMEOUT_MS is resolved once at module load from an env
 * var with a 5000ms default, so tests advance fake time by a large margin
 * (1 hour) rather than assuming a specific configured value.
 *
 * Jest-style (describe/it/expect/jest.fn).
 */
import { InjectionOrchestrator } from '../services/InjectionOrchestrator';
import {
  ArtifactNotFoundError,
  ArtifactChecksumError,
  ArtifactFormatError,
  InjectionTimeoutError,
  InjectionPartialError,
} from '../errors/Phase8Error';
import type { InjectionPayloadDTO } from '../dtos/outputs';
import type { ModelVersionId } from '../domain/types';
import type { ModelVersionDTO } from '../dtos/outputs';
// ---- fixtures ----

function makeModelVersion(overrides: Partial<ModelVersionDTO> = {}): ModelVersionDTO {
  return {
    model_version_id: 'mv-1' as ModelVersionId,
    training_run_id: 'run-1',
    strategy_run_id: 'strat-1',
    model_key: { strategy_id: 'strat-1', signal_type: 'BREAKOUT', regime_label: 'BULL' },
    status: 'CURRENT',
    is_ready: true,
    sample_size: 50,
    win_rate: { wins: 30, total: 50, rate: 0.6, is_reliable: true },
    signal_quality_score: {
      value: 0.7,
      confidence: 0.8,
      sample_size: 50,
      is_reliable: true,
      computed_from: 'LIVE_OUTCOMES',
    },
    kelly_calibration: {
      kelly_accuracy: 0.5,
      calibrated_win_rate: 0.6,
      historical_win_rate: 0.55,
      adjustment_factor: 1.09,
      sample_size: 50,
      is_reliable: true,
    },
    artifact_format: 'FREQUENCY_TABLE',
    artifact_payload: {},
    artifact_checksum: 'checksum-default',
    trained_at: new Date('2026-07-01T08:00:00.000Z'),
    activated_at: null,
    superseded_at: null,
    ...overrides,
  };
}

function makePayload(overrides: Partial<InjectionPayloadDTO> = {}): InjectionPayloadDTO {
  return {
    strategy_run_id: 'strat-1',
    assembled_at: new Date('2026-07-01T08:45:00.000Z'),
    model_versions: [makeModelVersion()],
    ...overrides,
  } as InjectionPayloadDTO;
}

function makeReconstructed(overrides: Partial<any> = {}) {
  return {
    model_version_id: 'mv-1' as ModelVersionId,
    model_key: { strategy_id: 'strat-1', signal_type: 'BREAKOUT', regime_label: 'BULL' },
    artifact_format: 'FREQUENCY_TABLE',
    signal_quality_model: { predict: jest.fn().mockReturnValue(0.6) },
    win_rate_provider: { getWinRate: jest.fn().mockReturnValue(0.55) },
    ...overrides,
  };
}

function makeMockModelRegistry() {
  return {
    register: jest.fn(),
    activate: jest.fn(),
    getCurrent: jest.fn(),
    getHistory: jest.fn(),
    getAllCurrentForRun: jest.fn(),
  };
}

function makeMockArtifactLoader() {
  return {
    load: jest.fn(),
    validateChecksum: jest.fn(),
  };
}

function makeMockSystemStateReader() {
  return {
    getKillSwitchState: jest.fn().mockResolvedValue('ACTIVE'),
  };
}

function makeMockLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeMockSignalEngine() {
  return { setQualityModel: jest.fn() };
}

function makeMockKellyCalculator() {
  return { setWinRateProvider: jest.fn() };
}

function makeOrchestrator(
  modelRegistry = makeMockModelRegistry(),
  artifactLoader = makeMockArtifactLoader(),
  systemStateReader = makeMockSystemStateReader(),
  logger = makeMockLogger()
) {
  return {
    orchestrator: new InjectionOrchestrator(modelRegistry as any, artifactLoader as any, systemStateReader as any, logger as any),
    modelRegistry,
    artifactLoader,
    systemStateReader,
    logger,
  };
}

// ============================================================
// assemble() — happy path
// ============================================================
describe('InjectionOrchestrator.assemble — happy path', () => {
  it('builds an InjectionPayloadDTO from all CURRENT reliable ModelVersions', async () => {
    const { orchestrator, modelRegistry } = makeOrchestrator();
    const versions = [makeModelVersion({ model_version_id: 'mv-1' }), makeModelVersion({ model_version_id: 'mv-2' })];
    modelRegistry.getAllCurrentForRun.mockResolvedValue(versions);

    const result = await orchestrator.assemble('strat-1');

    expect(result).not.toBeNull();
    expect(result!.strategy_run_id).toBe('strat-1');
    expect(result!.model_versions).toEqual(versions);
    expect(result!.assembled_at).toBeInstanceOf(Date);
  });

  it('calls modelRegistry.getAllCurrentForRun() with the given strategy_run_id', async () => {
    const { orchestrator, modelRegistry } = makeOrchestrator();
    modelRegistry.getAllCurrentForRun.mockResolvedValue([makeModelVersion()]);

    await orchestrator.assemble('strat-xyz');

    expect(modelRegistry.getAllCurrentForRun).toHaveBeenCalledWith('strat-xyz');
  });

  it('filters out unreliable (is_ready=false) CURRENT versions and logs a warning for the skipped count', async () => {
    const { orchestrator, modelRegistry, logger } = makeOrchestrator();
    const reliable = makeModelVersion({ model_version_id: 'mv-reliable', is_ready: true });
    const unreliable = makeModelVersion({ model_version_id: 'mv-unreliable', is_ready: false });
    modelRegistry.getAllCurrentForRun.mockResolvedValue([reliable, unreliable]);

    const result = await orchestrator.assemble('strat-1');

    expect(result!.model_versions).toEqual([reliable]);
    expect(logger.warn).toHaveBeenCalledWith(
      'InjectionOrchestrator.assemble: skipping unreliable CURRENT versions',
      expect.objectContaining({ skipped_count: 1 })
    );
  });
});

// ============================================================
// assemble() — boundary conditions
// ============================================================
describe('InjectionOrchestrator.assemble — boundary conditions', () => {
  it('returns null when there are no CURRENT versions at all', async () => {
    const { orchestrator, modelRegistry, logger } = makeOrchestrator();
    modelRegistry.getAllCurrentForRun.mockResolvedValue([]);

    const result = await orchestrator.assemble('strat-1');

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'InjectionOrchestrator.assemble: no CURRENT reliable models',
      expect.objectContaining({ strategy_run_id: 'strat-1' })
    );
  });

  it('returns null when every CURRENT version is unreliable (all filtered out)', async () => {
    const { orchestrator, modelRegistry } = makeOrchestrator();
    modelRegistry.getAllCurrentForRun.mockResolvedValue([
      makeModelVersion({ is_ready: false }),
      makeModelVersion({ is_ready: false }),
    ]);

    const result = await orchestrator.assemble('strat-1');

    expect(result).toBeNull();
  });

  it('does not log the "skipping unreliable" warning when zero versions were skipped', async () => {
    const { orchestrator, modelRegistry, logger } = makeOrchestrator();
    modelRegistry.getAllCurrentForRun.mockResolvedValue([makeModelVersion({ is_ready: true })]);

    await orchestrator.assemble('strat-1');

    expect(logger.warn).not.toHaveBeenCalledWith(
      'InjectionOrchestrator.assemble: skipping unreliable CURRENT versions',
      expect.anything()
    );
  });
});

// ============================================================
// assemble() — exception propagation
// ============================================================
describe('InjectionOrchestrator.assemble — exception propagation', () => {
  it('a modelRegistry.getAllCurrentForRun() failure propagates unmodified', async () => {
    const { orchestrator, modelRegistry } = makeOrchestrator();
    const dbError = new Error('registry read failed');
    modelRegistry.getAllCurrentForRun.mockRejectedValue(dbError);

    await expect(orchestrator.assemble('strat-1')).rejects.toBe(dbError);
  });
});

// ============================================================
// deliver() — KillSwitch tests
// ============================================================
describe('InjectionOrchestrator.deliver — KillSwitch gate', () => {
  it('ACTIVE: proceeds with delivery normally', async () => {
    const { orchestrator, artifactLoader, systemStateReader } = makeOrchestrator();
    systemStateReader.getKillSwitchState.mockResolvedValue('ACTIVE');
    artifactLoader.load.mockResolvedValue(makeReconstructed());

    const result = await orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator());

    expect(result.model_version_ids).toEqual(['mv-1']);
  });

  it('EMERGENCY_STOP: skips injection entirely, returns an empty/false InjectionResultDTO, and does not throw', async () => {
    const { orchestrator, artifactLoader, systemStateReader, logger } = makeOrchestrator();
    systemStateReader.getKillSwitchState.mockResolvedValue('EMERGENCY_STOP');

    const result = await orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator());

    expect(result.model_version_ids).toEqual([]);
    expect(result.quality_model_injected).toBe(false);
    expect(result.win_rate_provider_injected).toBe(false);
    expect(artifactLoader.load).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'InjectionOrchestrator.deliver: KillSwitch EMERGENCY_STOP — skipping injection',
      expect.objectContaining({ strategy_run_id: 'strat-1' })
    );
  });

  it('EMERGENCY_STOP: injection_latency_ms is still measured (non-negative number) even when skipped', async () => {
    const { orchestrator, systemStateReader } = makeOrchestrator();
    systemStateReader.getKillSwitchState.mockResolvedValue('EMERGENCY_STOP');

    const result = await orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator());

    expect(typeof result.injection_latency_ms).toBe('number');
    expect(result.injection_latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('the KillSwitch state is read exactly once per deliver() call, before any per-version processing', async () => {
    const { orchestrator, artifactLoader, systemStateReader } = makeOrchestrator();
    systemStateReader.getKillSwitchState.mockResolvedValue('ACTIVE');
    artifactLoader.load.mockResolvedValue(makeReconstructed());
    const payload = makePayload({ model_versions: [makeModelVersion({ model_version_id: 'mv-1' }), makeModelVersion({ model_version_id: 'mv-2' })] });

    await orchestrator.deliver(payload, makeMockSignalEngine(), makeMockKellyCalculator());

    expect(systemStateReader.getKillSwitchState).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// deliver() — happy path
// ============================================================
describe('InjectionOrchestrator.deliver — happy path', () => {
  it('loads each ModelVersion artifact and injects into both signalEngine and kellyCalculator', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    const reconstructed = makeReconstructed();
    artifactLoader.load.mockResolvedValue(reconstructed);
    const signalEngine = makeMockSignalEngine();
    const kellyCalculator = makeMockKellyCalculator();

    await orchestrator.deliver(makePayload(), signalEngine, kellyCalculator);

    expect(artifactLoader.load).toHaveBeenCalledWith('mv-1');
    expect(signalEngine.setQualityModel).toHaveBeenCalledWith(reconstructed.signal_quality_model);
    expect(kellyCalculator.setWinRateProvider).toHaveBeenCalledWith(reconstructed.win_rate_provider);
  });

  it('delivers multiple ModelVersions in the payload, one at a time, and reports all in model_version_ids', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockImplementation((id: string) => Promise.resolve(makeReconstructed({ model_version_id: id })));
    const payload = makePayload({
      model_versions: [makeModelVersion({ model_version_id: 'mv-1' }), makeModelVersion({ model_version_id: 'mv-2' })],
    });

    const result = await orchestrator.deliver(payload, makeMockSignalEngine(), makeMockKellyCalculator());

    expect(result.model_version_ids).toEqual(['mv-1', 'mv-2']);
    expect(artifactLoader.load).toHaveBeenCalledTimes(2);
  });

  it('sets quality_model_injected and win_rate_provider_injected to true on full success', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockResolvedValue(makeReconstructed());

    const result = await orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator());

    expect(result.quality_model_injected).toBe(true);
    expect(result.win_rate_provider_injected).toBe(true);
  });

  it('measures injection_latency_ms as a non-negative number', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockResolvedValue(makeReconstructed());

    const result = await orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator());

    expect(typeof result.injection_latency_ms).toBe('number');
    expect(result.injection_latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('logs an info message for each successfully delivered version and a final summary', async () => {
    const { orchestrator, artifactLoader, logger } = makeOrchestrator();
    artifactLoader.load.mockResolvedValue(makeReconstructed());

    await orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator());

    expect(logger.info).toHaveBeenCalledWith(
      'InjectionOrchestrator.deliver: version delivered',
      expect.objectContaining({ model_version_id: 'mv-1' })
    );
    expect(logger.info).toHaveBeenCalledWith('InjectionOrchestrator.deliver: finished', expect.anything());
  });

  it('does NOT call ModelRegistry.activate() itself — that is the caller (LearningEngine)\'s responsibility', async () => {
    const { orchestrator, artifactLoader, modelRegistry } = makeOrchestrator();
    artifactLoader.load.mockResolvedValue(makeReconstructed());

    await orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator());

    expect(modelRegistry.activate).not.toHaveBeenCalled();
  });
});

// ============================================================
// deliver() — failure paths (checksum / format / not-found: skip and continue)
// ============================================================
describe('InjectionOrchestrator.deliver — artifact-load failure paths (skip-and-continue)', () => {
  it('ArtifactChecksumError on one version: that version is skipped, logged CRITICAL, and delivery continues for the rest', async () => {
    const { orchestrator, artifactLoader, logger } = makeOrchestrator();
    artifactLoader.load
      .mockRejectedValueOnce(new ArtifactChecksumError('mv-1' as ModelVersionId, 'expected', 'actual'))
      .mockResolvedValueOnce(makeReconstructed({ model_version_id: 'mv-2' }));
    const payload = makePayload({
      model_versions: [makeModelVersion({ model_version_id: 'mv-1' }), makeModelVersion({ model_version_id: 'mv-2' })],
    });

    const result = await orchestrator.deliver(payload, makeMockSignalEngine(), makeMockKellyCalculator());

    expect(result.model_version_ids).toEqual(['mv-2']);
    expect(logger.error).toHaveBeenCalledWith(
      'InjectionOrchestrator.deliver: artifact load failed — CRITICAL, skipping version',
      expect.objectContaining({ model_version_id: 'mv-1' })
    );
  });

  it('ArtifactFormatError on one version: skipped and logged, delivery continues', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load
      .mockRejectedValueOnce(new ArtifactFormatError('mv-1' as ModelVersionId, 'BAD_FORMAT'))
      .mockResolvedValueOnce(makeReconstructed({ model_version_id: 'mv-2' }));
    const payload = makePayload({
      model_versions: [makeModelVersion({ model_version_id: 'mv-1' }), makeModelVersion({ model_version_id: 'mv-2' })],
    });

    const result = await orchestrator.deliver(payload, makeMockSignalEngine(), makeMockKellyCalculator());

    expect(result.model_version_ids).toEqual(['mv-2']);
  });

  it('ArtifactNotFoundError on one version: skipped and logged, delivery continues', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load
      .mockRejectedValueOnce(new ArtifactNotFoundError('mv-1' as ModelVersionId))
      .mockResolvedValueOnce(makeReconstructed({ model_version_id: 'mv-2' }));
    const payload = makePayload({
      model_versions: [makeModelVersion({ model_version_id: 'mv-1' }), makeModelVersion({ model_version_id: 'mv-2' })],
    });

    const result = await orchestrator.deliver(payload, makeMockSignalEngine(), makeMockKellyCalculator());

    expect(result.model_version_ids).toEqual(['mv-2']);
  });

  it('all versions failing with skip-eligible errors results in an empty model_version_ids, not a thrown error', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockRejectedValue(new ArtifactChecksumError('mv-1' as ModelVersionId, 'x', 'y'));

    const result = await orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator());

    expect(result.model_version_ids).toEqual([]);
    expect(result.quality_model_injected).toBe(false);
  });
});

// ============================================================
// deliver() — timeout tests
// ============================================================
describe('InjectionOrchestrator.deliver — timeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('a hung artifactLoader.load() (never resolving) times out with InjectionTimeoutError', async () => {
    jest.useFakeTimers();
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockImplementation(() => new Promise(() => {})); // never resolves

    const deliverPromise = orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator());
    const assertion = expect(deliverPromise).rejects.toBeInstanceOf(InjectionTimeoutError);

    // Advance well past any plausible configured INJECTION_TIMEOUT_MS.
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

    await assertion;
  });

  it('a timeout on one version is fatal to the whole deliver() call, not just that version (unlike checksum/format/not-found)', async () => {
    jest.useFakeTimers();
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockImplementation(() => new Promise(() => {}));
    const payload = makePayload({
      model_versions: [makeModelVersion({ model_version_id: 'mv-1' }), makeModelVersion({ model_version_id: 'mv-2' })],
    });

    const deliverPromise = orchestrator.deliver(payload, makeMockSignalEngine(), makeMockKellyCalculator());
    const assertion = expect(deliverPromise).rejects.toBeInstanceOf(InjectionTimeoutError);

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

    await assertion;
    // Only the first version's load() should have been attempted before the
    // fatal timeout stopped the loop — mv-2 never gets a chance.
    expect(artifactLoader.load).toHaveBeenCalledTimes(1);
  });

  it('a fast artifactLoader.load() does NOT trigger InjectionTimeoutError', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockResolvedValue(makeReconstructed());

    await expect(
      orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator())
    ).resolves.not.toThrow();
  });
});

// ============================================================
// deliver() — partial injection tests
// ============================================================
describe('InjectionOrchestrator.deliver — partial injection', () => {
  it('quality model injected but win-rate-provider injection fails: throws InjectionPartialError', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockResolvedValue(makeReconstructed());
    const signalEngine = makeMockSignalEngine(); // setQualityModel succeeds
    const kellyCalculator = { setWinRateProvider: jest.fn(() => { throw new Error('kelly calculator rejected model'); }) };

    await expect(
      orchestrator.deliver(makePayload(), signalEngine, kellyCalculator)
    ).rejects.toBeInstanceOf(InjectionPartialError);
  });

  it('InjectionPartialError carries quality_model_injected=true, win_rate_provider_injected=false for that failure mode', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockResolvedValue(makeReconstructed());
    const signalEngine = makeMockSignalEngine();
    const kellyCalculator = { setWinRateProvider: jest.fn(() => { throw new Error('rejected'); }) };

    try {
      await orchestrator.deliver(makePayload(), signalEngine, kellyCalculator);
      fail('expected deliver() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InjectionPartialError);
      expect((err as InjectionPartialError).quality_model_injected).toBe(true);
      expect((err as InjectionPartialError).win_rate_provider_injected).toBe(false);
    }
  });

  it('quality model injection itself fails (before win-rate-provider is attempted): throws InjectionPartialError with both flags false', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockResolvedValue(makeReconstructed());
    const signalEngine = { setQualityModel: jest.fn(() => { throw new Error('signal engine rejected model'); }) };
    const kellyCalculator = makeMockKellyCalculator();

    try {
      await orchestrator.deliver(makePayload(), signalEngine, kellyCalculator);
      fail('expected deliver() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InjectionPartialError);
      expect((err as InjectionPartialError).quality_model_injected).toBe(false);
      expect((err as InjectionPartialError).win_rate_provider_injected).toBe(false);
    }
    expect(kellyCalculator.setWinRateProvider).not.toHaveBeenCalled();
  });

  it('a partial injection failure is fatal to the whole deliver() call — later versions are never attempted', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockImplementation((id: string) => Promise.resolve(makeReconstructed({ model_version_id: id })));
    const signalEngine = makeMockSignalEngine();
    const kellyCalculator = { setWinRateProvider: jest.fn(() => { throw new Error('rejected'); }) };
    const payload = makePayload({
      model_versions: [makeModelVersion({ model_version_id: 'mv-1' }), makeModelVersion({ model_version_id: 'mv-2' })],
    });

    await expect(orchestrator.deliver(payload, signalEngine, kellyCalculator)).rejects.toBeInstanceOf(InjectionPartialError);
    expect(artifactLoader.load).toHaveBeenCalledTimes(1);
  });

  it('partial injection failure logs an error with the version and both injection flags', async () => {
    const { orchestrator, artifactLoader, logger } = makeOrchestrator();
    artifactLoader.load.mockResolvedValue(makeReconstructed());
    const kellyCalculator = { setWinRateProvider: jest.fn(() => { throw new Error('rejected'); }) };

    await expect(
      orchestrator.deliver(makePayload(), makeMockSignalEngine(), kellyCalculator)
    ).rejects.toBeInstanceOf(InjectionPartialError);

    expect(logger.error).toHaveBeenCalledWith(
      'InjectionOrchestrator.deliver: partial injection for version',
      expect.objectContaining({ model_version_id: 'mv-1', quality_model_injected: true, win_rate_provider_injected: false })
    );
  });
});

// ============================================================
// deliver() — boundary conditions
// ============================================================
describe('InjectionOrchestrator.deliver — boundary conditions', () => {
  it('an empty model_versions array in the payload delivers nothing and returns an empty result without error', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    const payload = makePayload({ model_versions: [] });

    const result = await orchestrator.deliver(payload, makeMockSignalEngine(), makeMockKellyCalculator());

    expect(result.model_version_ids).toEqual([]);
    expect(result.quality_model_injected).toBe(false);
    expect(result.win_rate_provider_injected).toBe(false);
    expect(artifactLoader.load).not.toHaveBeenCalled();
  });

  it('a single-version payload with success sets both injection flags true from just that one version', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockResolvedValue(makeReconstructed());

    const result = await orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator());

    expect(result.quality_model_injected).toBe(true);
    expect(result.win_rate_provider_injected).toBe(true);
  });
});

// ============================================================
// deliver() — exception propagation
// ============================================================
describe('InjectionOrchestrator.deliver — exception propagation', () => {
  it('a systemStateReader.getKillSwitchState() failure propagates unmodified', async () => {
    const { orchestrator, systemStateReader } = makeOrchestrator();
    const stateError = new Error('system_state table unreachable');
    systemStateReader.getKillSwitchState.mockRejectedValue(stateError);

    await expect(
      orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator())
    ).rejects.toBe(stateError);
  });

  it('an unexpected (non-artifact, non-timeout) error from artifactLoader.load() propagates rather than being skipped', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    const unexpectedError = new Error('totally unexpected failure mode');
    artifactLoader.load.mockRejectedValue(unexpectedError);

    await expect(
      orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator())
    ).rejects.toBe(unexpectedError);
  });
});

// ============================================================
// Contract verification — IInjectionOrchestrator (contracts §3.8)
// ============================================================
describe('InjectionOrchestrator — IInjectionOrchestrator contract conformance', () => {
  it('exposes exactly the two methods declared on IInjectionOrchestrator', () => {
    const { orchestrator } = makeOrchestrator();

    expect(typeof orchestrator.assemble).toBe('function');
    expect(typeof orchestrator.deliver).toBe('function');
  });

  it('assemble() returns Promise<InjectionPayloadDTO | null>', async () => {
    const { orchestrator, modelRegistry } = makeOrchestrator();
    modelRegistry.getAllCurrentForRun.mockResolvedValue([]);

    await expect(orchestrator.assemble('strat-1')).resolves.toBeNull();
  });

  it('deliver() returns Promise<InjectionResultDTO> with all six required fields present', async () => {
    const { orchestrator, artifactLoader } = makeOrchestrator();
    artifactLoader.load.mockResolvedValue(makeReconstructed());

    const result = await orchestrator.deliver(makePayload(), makeMockSignalEngine(), makeMockKellyCalculator());

    expect(result).toHaveProperty('strategy_run_id');
    expect(result).toHaveProperty('injected_at');
    expect(result).toHaveProperty('model_version_ids');
    expect(result).toHaveProperty('injection_latency_ms');
    expect(result).toHaveProperty('quality_model_injected');
    expect(result).toHaveProperty('win_rate_provider_injected');
  });
});
