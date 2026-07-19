/**
 * phase8/dtos/outputs.ts
 * Source: phase8-contracts-v1.md §7, corrected against actual usage in
 * services/RegimePriorUpdater.ts and its tests — the spec doc's DTO shape
 * for RegimePriorDTO omitted identity fields that are on the domain model's
 * RegimePrior aggregate (§2.3) and that the real code already relies on.
 * This version restores those fields flat, matching what's actually used.
 */
import type {
  ArtifactFormat,
  FailureReason,
  IndicatorRanking,
  InformationRatio,
  KellyCalibration,
  ModelKey,
  ModelVersionId,
  ModelVersionStatus,
  PeriodType,
  RegimeFitness,
  RegimePriorId,
  RegimePriorStatus,
  SignalQualityScore,
  TrainingRunId,
  TrainingRunStatus,
  WinRate,
} from '../domain/types';

// Re-exported so files that import these from dtos/outputs (as some existing
// service files do) keep working without needing an import-path edit.
export type { IndicatorRanking, WinRate, RegimeFitness, SignalQualityScore };

export interface TrainingRunDTO {
  readonly training_run_id: TrainingRunId;
  readonly strategy_run_id: string;
  readonly period_start: Date;
  readonly period_end: Date;
  readonly period_type: PeriodType;
  status: TrainingRunStatus;
  readonly record_count: number;
  readonly labelled_count: number;
  readonly reliable: boolean;
  model_version_id: ModelVersionId | null;
  readonly triggered_at: Date;
  completed_at: Date | null;
  failure_reason: FailureReason | null;
}

export interface ModelVersionDTO {
  readonly model_version_id: ModelVersionId;
  readonly training_run_id: TrainingRunId;
  readonly strategy_run_id: string;
  readonly model_key: ModelKey;
  status: ModelVersionStatus;
  readonly is_ready: boolean;
  readonly sample_size: number;
  readonly win_rate: WinRate;
  readonly signal_quality_score: SignalQualityScore;
  readonly kelly_calibration: KellyCalibration;
  readonly artifact_format: ArtifactFormat;
  readonly artifact_payload: Record<string, unknown>;
  readonly artifact_checksum: string;
  readonly trained_at: Date | null;
  activated_at: Date | null;
  superseded_at: Date | null;
}

export interface ModelArtifactDTO {
  readonly model_version_id: ModelVersionId;
  readonly artifact_format: ArtifactFormat;
  readonly artifact_payload: Record<string, unknown>;
  readonly artifact_checksum: string;
  readonly stored_at: Date;
}

// FLATTENED — carries full RegimePrior aggregate identity (domain model §2.3),
// not just the value-object fields the spec doc's §7 table listed.
export interface RegimePriorDTO {
  readonly regime_prior_id: RegimePriorId;
  readonly training_run_id: TrainingRunId;
  readonly regime_label: string;
  readonly symbol_id: string | null;
  readonly timeframe: string;
  status: RegimePriorStatus;
  readonly win_rate: WinRate;
  readonly avg_return_pct: number;
  readonly avg_volatility: number;
  readonly indicator_rankings: IndicatorRanking[];
  readonly regime_fitness: RegimeFitness;
  readonly computed_at: Date;
  superseded_at: Date | null;
}

export interface PerformanceSummaryDTO {
  readonly summary_id: string;
  readonly training_run_id: TrainingRunId;
  readonly strategy_run_id: string;
  readonly symbol_id: string | null;
  readonly regime: string;
  readonly period_type: PeriodType;
  readonly period_start: Date;
  readonly period_end: Date;
  readonly win_rate: WinRate;
  readonly sharpe_ratio: number | null;
  readonly profit_factor: number | null;
  readonly regime_fitness: RegimeFitness;
  readonly kelly_calibration: KellyCalibration;
  readonly avg_prediction_error: number | null;
  readonly record_count: number;
}

export interface IndicatorPerformanceDTO {
  readonly strategy_run_id: string;
  readonly training_run_id: TrainingRunId;
  readonly indicator_name: string;
  readonly indicator_params: string;
  readonly timeframe: string;
  readonly information_ratio: InformationRatio;
  readonly computed_at: Date;
}

export interface InjectionPayloadDTO {
  readonly strategy_run_id: string;
  readonly assembled_at: Date;
  readonly model_versions: ModelVersionDTO[];
}

export interface InjectionResultDTO {
  readonly strategy_run_id: string;
  readonly injected_at: Date;
  readonly model_version_ids: ModelVersionId[];
  readonly injection_latency_ms: number;
  readonly quality_model_injected: boolean;
  readonly win_rate_provider_injected: boolean;
}
