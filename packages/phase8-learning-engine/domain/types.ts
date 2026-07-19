/**
 * phase8/domain/types.ts
 * Source: phase8-domain-model-v1.md
 */

// ─── ID Aliases (§0) ──────────────────────────────────────────────────────────
export type TrainingRunId = string;
export type ModelVersionId = string;
export type RegimePriorId = string;

export type ArtifactFormat = 'FREQUENCY_TABLE' | 'LINEAR_WEIGHTS';

// ─── Value Objects (§3) ───────────────────────────────────────────────────────

export interface ModelKey {
  readonly strategy_id: string;
  readonly regime_label: string;
  readonly signal_type: string;
}

export interface WinRate {
  readonly wins: number;
  readonly total: number;
  readonly rate: number;
  readonly is_reliable: boolean;
}

export interface SignalQualityScore {
  readonly value: number;
  readonly confidence: number;
  readonly sample_size: number;
  readonly is_reliable: boolean;
  readonly computed_from: 'LIVE_OUTCOMES' | 'BACKTEST_PRIOR' | 'REGIME_WEIGHTED_BLEND';
}

export interface KellyCalibration {
  readonly kelly_accuracy: number;
  readonly calibrated_win_rate: number;
  readonly historical_win_rate: number;
  readonly adjustment_factor: number;
  readonly sample_size: number;
  readonly is_reliable: boolean;
}

export interface RegimeFitness {
  readonly score: number;
  readonly components: {
    readonly win_rate_component: number;
    readonly sharpe_component: number;
    readonly avg_return_component: number;
    readonly sample_weight: number;
  };
  readonly is_reliable: boolean;
}

export interface InformationRatio {
  readonly ratio: number;
  readonly sample_count: number;
  readonly is_reliable: boolean;
  readonly predictive_accuracy: number;
}

export type OutcomeLabel = 'WON' | 'LOST' | 'BREAKEVEN' | 'FORCED_EXIT';

export interface TradeOutcome {
  readonly actual_return: number;
  readonly mae: number;
  readonly mfe: number;
  readonly holding_bars: number;
  readonly was_winner: boolean;
  readonly realised_pnl: number;
  readonly outcome_label: OutcomeLabel;
}

export interface SlippageProfile {
  readonly avg_slippage_bps: number;
  readonly adverse_fill_count: number;
  readonly favorable_fill_count: number;
  readonly neutral_fill_count: number;
  readonly total_fill_count: number;
  readonly max_adverse_bps: number;
  readonly is_reliable: boolean;
}

export interface IndicatorRanking {
  readonly rank: number;
  readonly indicator_name: string;
  readonly indicator_params: string;
  readonly information_ratio: number;
  readonly predictive_accuracy: number;
}

export type PeriodType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ALL_TIME';

// ─── Enums (§9, §10, §11) ──────────────────────────────────────────────────────

export type FailureReason =
  | 'INGEST_DB_ERROR'
  | 'FEATURE_EXTRACTION_ERROR'
  | 'LABELLING_ERROR'
  | 'AGGREGATION_DB_ERROR'
  | 'MODEL_TRAINING_ERROR'
  | 'INJECTION_TIMEOUT'
  | 'CONCURRENT_RUN_CONFLICT'
  | 'UNKNOWN';

export type TrainingRunStatus =
  | 'PENDING'
  | 'INGESTING'
  | 'FEATURE_EXTRACTING'
  | 'OUTCOME_LABELLING'
  | 'AGGREGATING'
  | 'TRAINING'
  | 'TRAINED'
  | 'TRAINED_UNRELIABLE'
  | 'INJECTING'
  | 'INJECTED'
  | 'FAILED';

export type ModelVersionStatus = 'TRAINING' | 'TRAINED' | 'CURRENT' | 'SUPERSEDED' | 'FAILED';

export type RegimePriorStatus = 'COMPUTING' | 'CURRENT' | 'SUPERSEDED';

// ─── Constants (§8.1) ──────────────────────────────────────────────────────────

export const MIN_SAMPLE_SIZE = 30;
export const REGIME_FITNESS_MAX_SCORE = 1.0;
export const SIGNAL_QUALITY_MAX = 1.0;
export const SIGNAL_QUALITY_MIN = 0.0;
export const MAX_KELLY_ACCURACY = 1.0;
export const MIN_KELLY_ACCURACY = -1.0;
