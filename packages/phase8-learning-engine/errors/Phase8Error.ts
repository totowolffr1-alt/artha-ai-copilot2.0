/**
 * phase8/errors/Phase8Error.ts
 * Source: phase8-contracts-v1.md §8
 */
import type { TrainingRunId, ModelVersionId, ModelKey, TrainingRunStatus } from '../domain/types';

export abstract class Phase8Error extends Error {
  abstract readonly code: string;
}

export class DomainValidationError extends Phase8Error {
  readonly code = 'P8_DOMAIN_VALIDATION';
  constructor(public readonly field: string, public readonly constraint: string) {
    super(`Phase 8 domain validation failed: ${field} — ${constraint}`);
  }
}

export class ConcurrentTrainingRunError extends Phase8Error {
  readonly code = 'P8_CONCURRENT_RUN';
  constructor(
    public readonly strategy_run_id: string,
    public readonly existing_run_id: TrainingRunId,
    public readonly existing_status: TrainingRunStatus
  ) {
    super(
      `Training run already in progress for strategy_run_id='${strategy_run_id}': ` +
      `run_id=${existing_run_id}, status=${existing_status}`
    );
  }
}

export class ModelProductionError extends Phase8Error {
  readonly code = 'P8_MODEL_PRODUCTION';
  constructor(
    public readonly training_run_id: TrainingRunId,
    public readonly model_key: ModelKey,
    public readonly cause: string
  ) {
    super(`Model production failed for run=${training_run_id}, key=${JSON.stringify(model_key)}: ${cause}`);
  }
}

export class LabellingError extends Phase8Error {
  readonly code = 'P8_LABELLING_ERROR';
  constructor(public readonly record_id: string, public readonly cause: string) {
    super(`Outcome labelling failed for record_id='${record_id}': ${cause}`);
  }
}

export class IndicatorCalculationError extends Phase8Error {
  readonly code = 'P8_INDICATOR_CALC';
  constructor(public readonly training_run_id: TrainingRunId, public readonly cause: string) {
    super(`Indicator performance calculation failed for run=${training_run_id}: ${cause}`);
  }
}

export class IngestError extends Phase8Error {
  readonly code = 'P8_INGEST_DB_ERROR';
  constructor(public readonly strategy_run_id: string, public readonly cause: string) {
    super(`Ingestion failed for strategy_run_id='${strategy_run_id}': ${cause}`);
  }
}

export class AggregationError extends Phase8Error {
  readonly code = 'P8_AGGREGATION_DB_ERROR';
  constructor(public readonly training_run_id: TrainingRunId, public readonly cause: string) {
    super(`Aggregation failed for run=${training_run_id}: ${cause}`);
  }
}

// ─── Below: the 5 classes that were missing and breaking compilation ─────────

export class UnreliableModelInjectionError extends Phase8Error {
  readonly code = 'P8_UNRELIABLE_INJECTION';
  constructor(
    public readonly training_run_id: TrainingRunId,
    public readonly record_count: number,
    public readonly min_sample_size: number
  ) {
    super(
      `Cannot inject unreliable model from run=${training_run_id}: ` +
      `record_count=${record_count} < min_sample_size=${min_sample_size}`
    );
  }
}

export class UnreliableModelActivationError extends Phase8Error {
  readonly code = 'P8_UNRELIABLE_ACTIVATION';
  constructor(public readonly model_version_id: ModelVersionId) {
    super(`Cannot activate unreliable ModelVersion: ${model_version_id}`);
  }
}

export class OrphanedSupersessionError extends Phase8Error {
  readonly code = 'P8_ORPHANED_SUPERSESSION';
  constructor(public readonly model_key: ModelKey) {
    super(`Cannot supersede CURRENT model without a replacement for key=${JSON.stringify(model_key)}`);
  }
}

export class InjectionTimeoutError extends Phase8Error {
  readonly code = 'P8_INJECTION_TIMEOUT';
  constructor(
    public readonly strategy_run_id: string,
    public readonly timeout_ms: number
  ) {
    super(`Phase 5 injection timed out after ${timeout_ms}ms for strategy_run_id='${strategy_run_id}'`);
  }
}

export class InjectionPartialError extends Phase8Error {
  readonly code = 'P8_INJECTION_PARTIAL';
  constructor(
    public readonly quality_model_injected: boolean,
    public readonly win_rate_provider_injected: boolean,
    public readonly cause: string
  ) {
    super(
      `Partial injection — quality_model=${quality_model_injected}, ` +
      `win_rate_provider=${win_rate_provider_injected}: ${cause}`
    );
  }
}

export class ArtifactNotFoundError extends Phase8Error {
  readonly code = 'P8_ARTIFACT_NOT_FOUND';
  constructor(public readonly model_version_id: ModelVersionId) {
    super(`No artifact stored for model_version_id='${model_version_id}'`);
  }
}

export class ArtifactChecksumError extends Phase8Error {
  readonly code = 'P8_ARTIFACT_CHECKSUM';
  constructor(
    public readonly model_version_id: ModelVersionId,
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(
      `Artifact checksum mismatch for model_version_id='${model_version_id}': ` +
      `expected=${expected}, actual=${actual}`
    );
  }
}

export class ArtifactFormatError extends Phase8Error {
  readonly code = 'P8_ARTIFACT_FORMAT';
  constructor(
    public readonly model_version_id: ModelVersionId,
    public readonly format: string
  ) {
    super(`Unrecognised artifact_format='${format}' for model_version_id='${model_version_id}'`);
  }
}

// ─── Below: found missing via ModelRegistry.test.ts / RegimePriorUpdater.test.ts ─

export class DuplicateModelVersionError extends Phase8Error {
  readonly code = 'P8_DUPLICATE_MODEL_VERSION';
  constructor(public readonly model_version_id: ModelVersionId) {
    super(`ModelVersion already registered: ${model_version_id}`);
  }
}

export class ModelVersionNotFoundError extends Phase8Error {
  readonly code = 'P8_MODEL_VERSION_NOT_FOUND';
  constructor(public readonly model_version_id: ModelVersionId) {
    super(`ModelVersion not found: ${model_version_id}`);
  }
}

export class InvalidModelActivationStateError extends Phase8Error {
  readonly code = 'P8_INVALID_MODEL_ACTIVATION_STATE';
  constructor(
    public readonly model_version_id: ModelVersionId,
    public readonly actual_status: string
  ) {
    super(`Cannot activate ModelVersion ${model_version_id}: current status is '${actual_status}', expected 'TRAINED'`);
  }
}

export class OrphanedRegimePriorSupersessionError extends Phase8Error {
  readonly code = 'P8_ORPHANED_REGIME_PRIOR_SUPERSESSION';
  constructor(
    public readonly regime_label: string,
    public readonly symbol_id: string | null,
    public readonly timeframe: string
  ) {
    super(
      `Cannot supersede CURRENT regime prior without a replacement for ` +
      `(regime_label=${regime_label}, symbol_id=${symbol_id}, timeframe=${timeframe})`
    );
  }
}
