/**
 * phase8/dtos/inputs.ts
 * Source: phase8-contracts-v1.md §6, corrected against actual usage in
 * services/RegimePriorUpdater.ts and its tests — LabelledOutcomeDTO's
 * TradeOutcome and regime/symbol/timeframe fields are flattened onto the
 * top level rather than nested, matching what the real code already reads
 * (record.was_winner, record.actual_return, record.regime_label, etc.).
 */
import type { ModelKey, OutcomeLabel, SlippageProfile } from '../domain/types';

// From Phase 3 learning_records table
export interface LearningRecordDTO {
  readonly record_id: string;
  readonly trade_id: string;
  readonly signal_id: string | null;
  readonly symbol_id: string;
  readonly regime: string;
  readonly features_at_entry: Record<string, unknown>;
  readonly features_at_exit: Record<string, unknown> | null;
  readonly predicted_return: number | null;
  readonly actual_return: number;
  readonly prediction_error: number | null;
  readonly entry_price: number;
  readonly exit_price: number;
  readonly realised_pnl: number;
  readonly mae: number;
  readonly mfe: number;
  readonly holding_bars: number;
  readonly was_winner: boolean;
  readonly kelly_used: number | null;
  readonly kelly_optimal: number | null;
  readonly trade_opened_at: Date;
  readonly trade_closed_at: Date;
  readonly recorded_at: Date;
}

// From Phase 7 execution_results + execution_fills tables
export interface ExecutionOutcomeDTO {
  readonly signal_id: string;
  readonly order_id: string;
  readonly final_status: 'FILLED' | 'REJECTED' | 'CANCELLED';
  readonly total_filled_qty: number;
  readonly avg_fill_price: number | null;
  readonly realized_slippage_bps: number | null;
  readonly total_attempts: number;
  readonly total_execution_latency_ms: number | null;
  readonly slippage_profile: SlippageProfile;
}

// Internal — produced by IFeaturePipeline
export interface FeatureVectorDTO {
  readonly record_id: string;
  readonly signal_id: string | null;
  readonly symbol_id: string;
  readonly regime_label: string;
  readonly signal_type: string;
  readonly strategy_id: string;
  readonly timeframe: string;
  readonly features: Record<string, number>;
  readonly raw_features_at_entry: Record<string, unknown>;
  readonly extracted_at: Date;
}

// Internal — produced by IOutcomeLabeller.
// FLATTENED: TradeOutcome fields (actual_return, mae, mfe, was_winner, etc.)
// and regime/symbol/timeframe identity are top-level here, not nested, to
// match how services/RegimePriorUpdater.ts and its tests already read them.
export interface LabelledOutcomeDTO {
  readonly record_id: string;
  readonly model_key: ModelKey;
  readonly regime_label: string;
  readonly symbol_id: string | null;
  readonly timeframe: string;
  readonly feature_vector: FeatureVectorDTO;
  readonly actual_return: number;
  readonly mae: number;
  readonly mfe: number;
  readonly holding_bars: number;
  readonly was_winner: boolean;
  readonly realised_pnl: number;
  readonly outcome_label: OutcomeLabel;
  readonly execution_outcome: ExecutionOutcomeDTO | null;
  readonly labelled_at: Date;
}
