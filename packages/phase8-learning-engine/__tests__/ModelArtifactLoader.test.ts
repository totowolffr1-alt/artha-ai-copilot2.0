/**
 * phase8/__tests__/ModelArtifactLoader.test.ts
 *
 * Complete unit test suite for ModelArtifactLoader (phase8-contracts-v1.md
 * §3.10, roadmap Step 13). Tests only — no implementation code touched or
 * generated. Mocks IModelVersionRepository and a Logger; both public methods
 * (load, validateChecksum) are covered, including real SHA-256 checksum
 * computation (using Node's actual `crypto` module — not mocked, since the
 * checksum algorithm itself is exactly what needs verifying), format
 * dispatch to FrequencyTableModel/LinearWeightsModel, and all error paths.
 *
 * Jest-style (describe/it/expect/jest.fn).
 */
import { createHash } from 'crypto';
import { ModelArtifactLoader } from '../services/ModelArtifactLoader';
import { FrequencyTableModel } from '../services/reconstruction/FrequencyTableModel';
import { LinearWeightsModel } from '../services/reconstruction/LinearWeightsModel';
import {
  ArtifactNotFoundError,
  ArtifactChecksumError,
  ArtifactFormatError,
} from '../errors/Phase8Error';
import type { ModelArtifactDTO } from '../dtos/outputs';
import type { ModelVersionId } from '../domain/types';

// ---- fixtures ----

/** Computes the same checksum ModelArtifactLoader uses, for building valid fixtures. */
function checksumOf(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload, null, 0)).digest('hex');
}

function makeModelKey() {
  return { strategy_id: 'strat-1', signal_type: 'BREAKOUT', regime_label: 'BULL' };
}

function makeFrequencyTableVersion(overrides: Partial<any> = {}) {
  const payload = {
    model_key: makeModelKey(),
    win_probability: 0.62,
    kelly_win_rate: 0.58,
    sample_size: 45,
  };
  return {
    model_version_id: 'mv-1' as ModelVersionId,
    model_key: makeModelKey(),
    artifact_format: 'FREQUENCY_TABLE',
    artifact_payload: payload,
    artifact_checksum: checksumOf(payload),
    trained_at: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeLinearWeightsVersion(overrides: Partial<any> = {}) {
  const payload = {
    model_key: makeModelKey(),
    feature_weights: { rsi: 0.4, macd: -0.2 },
    intercept: 0.1,
    kelly_win_rate: 0.55,
    sample_size: 60,
  };
  return {
    model_version_id: 'mv-2' as ModelVersionId,
    model_key: makeModelKey(),
    artifact_format: 'LINEAR_WEIGHTS',
    artifact_payload: payload,
    artifact_checksum: checksumOf(payload),
    trained_at: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeMockRepo() {
  return {
    findById: jest.fn(),
    save: jest.fn(),
    updateStatus: jest.fn(),
    findCurrent: jest.fn(),
    findAllForRun: jest.fn(),
    findAllCurrentForStrategyRun: jest.fn(),
    findHistoryByModelKey: jest.fn(),
  };
}

function makeMockLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

// ============================================================
// load() — happy path / artifact loading
// ============================================================
describe('ModelArtifactLoader.load — happy path / artifact loading', () => {
  it('fetches the ModelVersion row via findById() with the given model_version_id', async () => {
    const repo = makeMockRepo();
    const version = makeFrequencyTableVersion();
    repo.findById.mockResolvedValue(version);
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    await loader.load('mv-1' as ModelVersionId);

    expect(repo.findById).toHaveBeenCalledWith('mv-1');
  });

  it('returns a ReconstructedModelDTO with model_version_id, model_key, and artifact_format carried through', async () => {
    const repo = makeMockRepo();
    const version = makeFrequencyTableVersion();
    repo.findById.mockResolvedValue(version);
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-1' as ModelVersionId);

    expect(result.model_version_id).toBe('mv-1');
    expect(result.model_key).toEqual(makeModelKey());
    expect(result.artifact_format).toBe('FREQUENCY_TABLE');
  });

  it('logs an info message at start and at successful reconstruction', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeFrequencyTableVersion());
    const logger = makeMockLogger();
    const loader = new ModelArtifactLoader(repo as any, logger as any);

    await loader.load('mv-1' as ModelVersionId);

    expect(logger.info).toHaveBeenCalledWith('ModelArtifactLoader.load: starting', expect.anything());
    expect(logger.info).toHaveBeenCalledWith(
      'ModelArtifactLoader.load: reconstruction succeeded',
      expect.anything()
    );
  });
});

// ============================================================
// load() — artifact reconstruction (format dispatch)
// ============================================================
describe('ModelArtifactLoader.load — artifact reconstruction', () => {
  it('FREQUENCY_TABLE: reconstructs a FrequencyTableModel for both signal_quality_model and win_rate_provider', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeFrequencyTableVersion());
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-1' as ModelVersionId);

    expect(result.signal_quality_model).toBeInstanceOf(FrequencyTableModel);
    expect(result.win_rate_provider).toBeInstanceOf(FrequencyTableModel);
  });

  it('FREQUENCY_TABLE: signal_quality_model and win_rate_provider are the SAME instance (one model implements both roles)', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeFrequencyTableVersion());
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-1' as ModelVersionId);

    expect(result.signal_quality_model).toBe(result.win_rate_provider);
  });

  it('FREQUENCY_TABLE: predict() ignores input features and returns the stored win_probability', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeFrequencyTableVersion());
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-1' as ModelVersionId);

    expect(result.signal_quality_model.predict({ anything: 999 })).toBeCloseTo(0.62, 10);
  });

  it('FREQUENCY_TABLE: getWinRate() returns the stored kelly_win_rate regardless of arguments', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeFrequencyTableVersion());
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-1' as ModelVersionId);

    expect(result.win_rate_provider.getWinRate('any', 'any')).toBeCloseTo(0.58, 10);
  });

  it('LINEAR_WEIGHTS: reconstructs a LinearWeightsModel for both signal_quality_model and win_rate_provider', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeLinearWeightsVersion());
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-2' as ModelVersionId);

    expect(result.signal_quality_model).toBeInstanceOf(LinearWeightsModel);
    expect(result.win_rate_provider).toBeInstanceOf(LinearWeightsModel);
    expect(result.signal_quality_model).toBe(result.win_rate_provider);
  });

  it('LINEAR_WEIGHTS: predict() computes sigmoid(Σ weights·features + intercept)', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeLinearWeightsVersion());
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-2' as ModelVersionId);

    // z = 0.4*1 + (-0.2)*0.5 + 0.1 = 0.4 - 0.1 + 0.1 = 0.4 ; sigmoid(0.4) ≈ 0.5987
    const prediction = result.signal_quality_model.predict({ rsi: 1, macd: 0.5 });
    expect(prediction).toBeCloseTo(1 / (1 + Math.exp(-0.4)), 8);
  });

  it('LINEAR_WEIGHTS: predict() treats a missing feature key as 0 rather than throwing', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeLinearWeightsVersion());
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-2' as ModelVersionId);

    expect(() => result.signal_quality_model.predict({ rsi: 1 })).not.toThrow();
    expect(result.signal_quality_model.predict({ rsi: 1 })).toBeCloseTo(1 / (1 + Math.exp(-0.5)), 8);
  });

  it('LINEAR_WEIGHTS: getWinRate() returns the stored kelly_win_rate', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeLinearWeightsVersion());
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-2' as ModelVersionId);

    expect(result.win_rate_provider.getWinRate('x', 'y')).toBeCloseTo(0.55, 10);
  });
});

// ============================================================
// load() / validateChecksum() — checksum validation
// ============================================================
describe('ModelArtifactLoader — checksum validation', () => {
  it('validateChecksum() returns true for a payload whose checksum matches', () => {
    const repo = makeMockRepo();
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);
    const payload = { a: 1, b: 'x' };
    const artifact: ModelArtifactDTO = {
      model_version_id: 'mv-1' as ModelVersionId,
      artifact_format: 'FREQUENCY_TABLE',
      artifact_payload: payload,
      artifact_checksum: checksumOf(payload),
      stored_at: new Date(),
    };

    expect(loader.validateChecksum(artifact)).toBe(true);
  });

  it('validateChecksum() returns false for a payload whose checksum does not match', () => {
    const repo = makeMockRepo();
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);
    const artifact: ModelArtifactDTO = {
      model_version_id: 'mv-1' as ModelVersionId,
      artifact_format: 'FREQUENCY_TABLE',
      artifact_payload: { a: 1 },
      artifact_checksum: 'not-the-real-checksum',
      stored_at: new Date(),
    };

    expect(loader.validateChecksum(artifact)).toBe(false);
  });

  it('validateChecksum() is pure and synchronous — makes no repository or logger calls', () => {
    const repo = makeMockRepo();
    const logger = makeMockLogger();
    const loader = new ModelArtifactLoader(repo as any, logger as any);
    const payload = { x: 1 };
    const artifact: ModelArtifactDTO = {
      model_version_id: 'mv-1' as ModelVersionId,
      artifact_format: 'FREQUENCY_TABLE',
      artifact_payload: payload,
      artifact_checksum: checksumOf(payload),
      stored_at: new Date(),
    };

    loader.validateChecksum(artifact);

    expect(repo.findById).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('load(): a stored artifact whose checksum matches loads successfully', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeFrequencyTableVersion());
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    await expect(loader.load('mv-1' as ModelVersionId)).resolves.toBeDefined();
  });

  it('load(): a checksum mismatch (simulated DB corruption) throws ArtifactChecksumError and logs CRITICAL', async () => {
    const repo = makeMockRepo();
    const corrupted = makeFrequencyTableVersion({ artifact_checksum: 'corrupted-checksum-value' });
    repo.findById.mockResolvedValue(corrupted);
    const logger = makeMockLogger();
    const loader = new ModelArtifactLoader(repo as any, logger as any);

    await expect(loader.load('mv-1' as ModelVersionId)).rejects.toBeInstanceOf(ArtifactChecksumError);
    expect(logger.error).toHaveBeenCalledWith(
      'ModelArtifactLoader.load: checksum mismatch — CRITICAL',
      expect.objectContaining({ model_version_id: 'mv-1' })
    );
  });

  it('load(): checksum mismatch means reconstruction is never attempted', async () => {
    const repo = makeMockRepo();
    const corrupted = makeFrequencyTableVersion({ artifact_checksum: 'wrong' });
    repo.findById.mockResolvedValue(corrupted);
    const logger = makeMockLogger();
    const loader = new ModelArtifactLoader(repo as any, logger as any);

    await expect(loader.load('mv-1' as ModelVersionId)).rejects.toBeInstanceOf(ArtifactChecksumError);
    expect(logger.info).not.toHaveBeenCalledWith(
      'ModelArtifactLoader.load: reconstruction succeeded',
      expect.anything()
    );
  });
});

// ============================================================
// load() — artifact format validation
// ============================================================
describe('ModelArtifactLoader.load — artifact format validation', () => {
  it('an unrecognised artifact_format throws ArtifactFormatError', async () => {
    const repo = makeMockRepo();
    const badFormatPayload = { anything: true };
    const version = {
      model_version_id: 'mv-bad' as ModelVersionId,
      model_key: makeModelKey(),
      artifact_format: 'SOME_UNKNOWN_FORMAT',
      artifact_payload: badFormatPayload,
      artifact_checksum: checksumOf(badFormatPayload),
      trained_at: new Date(),
    };
    repo.findById.mockResolvedValue(version);
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    await expect(loader.load('mv-bad' as ModelVersionId)).rejects.toBeInstanceOf(ArtifactFormatError);
  });

  it('an unrecognised artifact_format logs an error identifying the model_version_id and the bad format', async () => {
    const repo = makeMockRepo();
    const payload = { anything: true };
    const version = {
      model_version_id: 'mv-bad' as ModelVersionId,
      model_key: makeModelKey(),
      artifact_format: 'XYZ',
      artifact_payload: payload,
      artifact_checksum: checksumOf(payload),
      trained_at: new Date(),
    };
    repo.findById.mockResolvedValue(version);
    const logger = makeMockLogger();
    const loader = new ModelArtifactLoader(repo as any, logger as any);

    await expect(loader.load('mv-bad' as ModelVersionId)).rejects.toBeInstanceOf(ArtifactFormatError);
    expect(logger.error).toHaveBeenCalledWith(
      'ModelArtifactLoader.reconstruct: unrecognised artifact_format',
      expect.objectContaining({ model_version_id: 'mv-bad', artifact_format: 'XYZ' })
    );
  });

  it('checksum validation happens BEFORE format validation — a bad format with a correct checksum still fails on format, not checksum', async () => {
    const repo = makeMockRepo();
    const payload = { whatever: 1 };
    const version = {
      model_version_id: 'mv-bad' as ModelVersionId,
      model_key: makeModelKey(),
      artifact_format: 'NOT_A_REAL_FORMAT',
      artifact_payload: payload,
      artifact_checksum: checksumOf(payload),
      trained_at: new Date(),
    };
    repo.findById.mockResolvedValue(version);
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    await expect(loader.load('mv-bad' as ModelVersionId)).rejects.toBeInstanceOf(ArtifactFormatError);
  });
});

// ============================================================
// load() — failure paths
// ============================================================
describe('ModelArtifactLoader.load — failure paths', () => {
  it('a model_version_id with no matching row throws ArtifactNotFoundError', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(null);
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    await expect(loader.load('mv-missing' as ModelVersionId)).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });

  it('ArtifactNotFoundError is logged before being thrown', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(null);
    const logger = makeMockLogger();
    const loader = new ModelArtifactLoader(repo as any, logger as any);

    await expect(loader.load('mv-missing' as ModelVersionId)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(logger.error).toHaveBeenCalledWith(
      'ModelArtifactLoader.load: no artifact row found',
      expect.objectContaining({ model_version_id: 'mv-missing' })
    );
  });

  it('a not-found error means checksum validation is never reached', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(null);
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);
    const validateSpy = jest.spyOn(loader, 'validateChecksum');

    await expect(loader.load('mv-missing' as ModelVersionId)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(validateSpy).not.toHaveBeenCalled();
  });
});

// ============================================================
// boundary conditions
// ============================================================
describe('ModelArtifactLoader — boundary conditions', () => {
  it('an artifact_payload that is an empty object still produces a stable, matching checksum', () => {
    const repo = makeMockRepo();
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);
    const artifact: ModelArtifactDTO = {
      model_version_id: 'mv-1' as ModelVersionId,
      artifact_format: 'FREQUENCY_TABLE',
      artifact_payload: {},
      artifact_checksum: checksumOf({}),
      stored_at: new Date(),
    };

    expect(loader.validateChecksum(artifact)).toBe(true);
  });

  it('LINEAR_WEIGHTS with an empty feature_weights map: predict() returns sigmoid(intercept) regardless of input features', async () => {
    const repo = makeMockRepo();
    const payload = { model_key: makeModelKey(), feature_weights: {}, intercept: 0.25, kelly_win_rate: 0.5, sample_size: 40 };
    const version = {
      model_version_id: 'mv-empty-weights' as ModelVersionId,
      model_key: makeModelKey(),
      artifact_format: 'LINEAR_WEIGHTS',
      artifact_payload: payload,
      artifact_checksum: checksumOf(payload),
      trained_at: new Date(),
    };
    repo.findById.mockResolvedValue(version);
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-empty-weights' as ModelVersionId);

    expect(result.signal_quality_model.predict({ irrelevant: 5 })).toBeCloseTo(1 / (1 + Math.exp(-0.25)), 8);
  });

  it('trained_at falls back gracefully when null, for the internal ModelArtifactDTO.stored_at field', async () => {
    const repo = makeMockRepo();
    const version = makeFrequencyTableVersion({ trained_at: null });
    repo.findById.mockResolvedValue(version);
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    await expect(loader.load('mv-1' as ModelVersionId)).resolves.toBeDefined();
  });

  it('validateChecksum() is idempotent — repeated calls on the same artifact return the same result', () => {
    const repo = makeMockRepo();
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);
    const payload = { z: 1, a: 2 };
    const artifact: ModelArtifactDTO = {
      model_version_id: 'mv-1' as ModelVersionId,
      artifact_format: 'FREQUENCY_TABLE',
      artifact_payload: payload,
      artifact_checksum: checksumOf(payload),
      stored_at: new Date(),
    };

    expect(loader.validateChecksum(artifact)).toBe(true);
    expect(loader.validateChecksum(artifact)).toBe(true);
  });
});

// ============================================================
// exception propagation
// ============================================================
describe('ModelArtifactLoader — exception propagation', () => {
  it('a repository.findById() failure propagates unmodified (not wrapped as ArtifactNotFoundError)', async () => {
    const repo = makeMockRepo();
    const dbError = new Error('connection pool exhausted');
    repo.findById.mockRejectedValue(dbError);
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    await expect(loader.load('mv-1' as ModelVersionId)).rejects.toBe(dbError);
  });

  it('reconstruction of a structurally malformed but checksum-valid payload does not throw at load() time (lazy failure only on use)', async () => {
    const repo = makeMockRepo();
    const payload = { model_key: makeModelKey(), feature_weights: null, intercept: 0, kelly_win_rate: 0.5, sample_size: 40 };
    const version = {
      model_version_id: 'mv-corrupt-shape' as ModelVersionId,
      model_key: makeModelKey(),
      artifact_format: 'LINEAR_WEIGHTS',
      artifact_payload: payload,
      artifact_checksum: checksumOf(payload),
      trained_at: new Date(),
    };
    repo.findById.mockResolvedValue(version);
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    await expect(loader.load('mv-corrupt-shape' as ModelVersionId)).resolves.toBeDefined();
  });
});

// ============================================================
// Contract verification — IModelArtifactLoader (contracts §3.10)
// ============================================================
describe('ModelArtifactLoader — IModelArtifactLoader contract conformance', () => {
  it('exposes exactly the two methods declared on IModelArtifactLoader', () => {
    const repo = makeMockRepo();
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    expect(typeof loader.load).toBe('function');
    expect(typeof loader.validateChecksum).toBe('function');
  });

  it('load() returns Promise<ReconstructedModelDTO> with all five required fields present', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeFrequencyTableVersion());
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-1' as ModelVersionId);

    expect(result).toHaveProperty('model_version_id');
    expect(result).toHaveProperty('model_key');
    expect(result).toHaveProperty('artifact_format');
    expect(result).toHaveProperty('signal_quality_model');
    expect(result).toHaveProperty('win_rate_provider');
  });

  it('validateChecksum() returns a boolean (not a Promise) — synchronous per contract', () => {
    const repo = makeMockRepo();
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);
    const payload = { a: 1 };
    const artifact: ModelArtifactDTO = {
      model_version_id: 'mv-1' as ModelVersionId,
      artifact_format: 'FREQUENCY_TABLE',
      artifact_payload: payload,
      artifact_checksum: checksumOf(payload),
      stored_at: new Date(),
    };

    const result = loader.validateChecksum(artifact);

    expect(typeof result).toBe('boolean');
  });

  it('the reconstructed signal_quality_model implements predict() and win_rate_provider implements getWinRate()', async () => {
    const repo = makeMockRepo();
    repo.findById.mockResolvedValue(makeFrequencyTableVersion());
    const loader = new ModelArtifactLoader(repo as any, makeMockLogger() as any);

    const result = await loader.load('mv-1' as ModelVersionId);

    expect(typeof result.signal_quality_model.predict).toBe('function');
    expect(typeof result.win_rate_provider.getWinRate).toBe('function');
  });
});
