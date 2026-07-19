/**
 * Phase 5A — Core Contracts
 *
 * Extends Phase 4 without modifying any existing Phase 4 interface.
 * All Phase 4 consumers of IBarEvent continue to compile unchanged.
 *
 * Depends on: Phase 4 frozen contracts (IBarEvent, SignalEvent,
 *             RiskValidationResult, ICostResult)
 * Feeds into: Phase 5B (IIndicator, IndicatorPipeline)
 *             Phase 5C (RegimeEngine)
 *             Phase 5D (SignalEngine)
 */

// ─────────────────────────────────────────────────────────────
// RE-EXPORT: Phase 4 frozen base (do not modify)
// ─────────────────────────────────────────────────────────────

/**
 * Phase 4A frozen — reproduced here for reference ONLY.
 * Source of truth: src/backtesting/interfaces/IBarEvent.ts
 * DO NOT modify this interface.
 */
export interface IBarEvent {
  symbol: string;
  timeframe: Timeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: bigint;
  bucket_ts: Date;
}

// ─────────────────────────────────────────────────────────────
// CORRECTION 3 — EnrichedBarEvent
// File: src/backtesting/interfaces/IBarEvent.ts
// ─────────────────────────────────────────────────────────────

/**
 * Extends IBarEvent with optional indicator values.
 *
 * Rules:
 * - All Phase 4 IBarEvent consumers accept EnrichedBarEvent unchanged
 *   (structural subtype — indicators field is optional).
 * - IndicatorPipeline (Phase 5B) populates indicators before emitting.
 * - Key format: "<indicator_name>_<period>" e.g. "ema_20", "rsi_14", "atr_14"
 * - Values are always numbers (NaN permitted during warmup, never after).
 * - Map is immutable after emission — consumers must not mutate it.
 */
export interface EnrichedBarEvent extends IBarEvent {
  readonly indicators?: ReadonlyMap<string, number>;
}

// ─────────────────────────────────────────────────────────────
// SUPPORTING ENUMS & PRIMITIVES
// ─────────────────────────────────────────────────────────────

/** Candle timeframes supported by HistoricalDataFeed and live feed. */
export type Timeframe =
  | '1m' | '3m' | '5m' | '10m' | '15m' | '30m'
  | '1h' | '2h' | '4h'
  | '1d' | '1w';

/** NSE/NFO/MCX market segments. */
export type Segment = 'NSE_EQ' | 'NFO_FUT' | 'NFO_OPT' | 'MCX_FUT' | 'MCX_OPT';

/** Order direction. */
export type Direction = 'LONG' | 'SHORT';

/** Product type — controls MIS forced-exit and margin rules. */
export type ProductType = 'MIS' | 'NRML' | 'CNC';

/** Stop-loss variants supported by SLManager (Phase 4C). */
export type SLType = 'fixed' | 'trailing' | 'time_based';

/** Take-profit variants supported by TargetManager (Phase 4C). */
export type TPType = 'fixed' | 'scaled' | 'r_multiple';

/** Slippage model keys supported by SlippageModel (Phase 4D). */
export type SlippageModelKey =
  | 'zero' | 'fixed_paise' | 'percentage' | 'spread' | 'volume_adjusted';

/** Brokerage profile keys supported by BrokerageModel (Phase 4D). */
export type BrokerageProfileKey = 'zero' | 'flat_fee' | 'percentage';

/** SL/TP conflict resolution — Phase 4C config. */
export type SLTPConflict = 'sl_wins' | 'tp_wins';

/** Overfitting verdict emitted by WalkForwardController. */
export type OverfitVerdict = 'pass' | 'overfit' | 'insufficient_folds';

// ─────────────────────────────────────────────────────────────
// STOP-LOSS CONFIG
// ─────────────────────────────────────────────────────────────

export interface SLConfig {
  /** Discriminator — selects SLManager behaviour. */
  type: SLType;

  /**
   * Fixed SL: absolute price distance from entry (in points/rupees).
   * Trailing SL: trail distance (points). Time-based: not used.
   */
  value?: number;

  /**
   * Time-based SL only: bar count after which position is force-exited
   * regardless of P&L. Must be a positive integer.
   */
  timeout_bars?: number;

  /**
   * Trailing SL only: minimum profit (points) before trail activates.
   * Prevents SL from trailing into a loss before any profit is made.
   */
  trail_activation_offset?: number;
}

// ─────────────────────────────────────────────────────────────
// TAKE-PROFIT CONFIG
// ─────────────────────────────────────────────────────────────

export interface TPLevel {
  /** Fraction of position to exit at this level. All levels must sum to 1.0. */
  fraction: number;

  /**
   * Fixed / scaled TP: absolute price distance from entry (points).
   * R-multiple TP: multiple of initial risk (e.g. 2.0 = 2R).
   */
  value: number;
}

export interface TPConfig {
  type: TPType;

  /**
   * One or more exit levels. Fractions must sum to exactly 1.0.
   * Validated at StrategyDefinition load time — BacktestRunner throws on mismatch.
   */
  levels: [TPLevel, ...TPLevel[]]; // at least one level required
}

// ─────────────────────────────────────────────────────────────
// RISK CONFIG (pointer into risk_limits table)
// ─────────────────────────────────────────────────────────────

/**
 * Inline risk parameters embedded in StrategyDefinition.
 * BacktestRunner seeds risk_limits table from this before run start.
 * RiskValidationPipeline (Phase 4E) reads risk_limits — never reads this struct directly.
 *
 * All monetary values in rupees (converted to paise by seeding layer).
 */
export interface RiskConfig {
  /** Maximum capital deployed per trade as fraction of portfolio (0 < x ≤ 1). */
  max_position_fraction: number;

  /** Session daily loss limit in rupees. Circuit breaker — irrecoverable within session. */
  daily_loss_limit_rupees: number;

  /** Maximum portfolio drawdown from peak before fold halts (fraction, e.g. 0.15 = 15%). */
  max_drawdown_fraction: number;

  /** Maximum gross exposure as fraction of portfolio (e.g. 2.0 = 200%). */
  max_gross_exposure_fraction: number;

  /** Maximum net exposure as fraction of portfolio. */
  max_net_exposure_fraction: number;

  /** Maximum single-symbol exposure as fraction of portfolio. */
  max_symbol_exposure_fraction: number;

  /** Maximum number of concurrently open trades. */
  max_concurrent_trades: number;

  /** Allow multiple entries in same symbol (pyramiding). */
  allow_pyramid: boolean;

  /**
   * SPAN margin rates by segment (fraction of notional).
   * Conservative flat rates; not fetched from live NSE SPAN calculator.
   * e.g. { NFO_FUT: 0.12, NFO_OPT_SHORT: 0.35, NFO_OPT_LONG: 0 }
   */
  span_margin_rates: Partial<Record<Segment, number>>;
}

// ─────────────────────────────────────────────────────────────
// COST CONFIG (passed to CostAggregator at BacktestRunner start)
// ─────────────────────────────────────────────────────────────

export interface CostConfig {
  brokerage_profile: BrokerageProfileKey;

  /**
   * PercentageProfile only: rate per segment (fraction of turnover).
   * e.g. { NSE_EQ: 0.003, NFO_FUT: 0.002 }
   */
  brokerage_rate_by_segment?: Partial<Record<Segment, number>>;

  slippage_model: SlippageModelKey;

  /**
   * FixedPaiseModel only: slippage per leg in paise.
   * e.g. { NFO_FUT: 200, NFO_OPT: 100 }
   */
  fixed_slippage_paise_by_segment?: Partial<Record<Segment, number>>;

  /**
   * PercentageModel only: slippage as fraction of fill price.
   * e.g. { NSE_EQ: 0.0005 }
   */
  slippage_pct_by_segment?: Partial<Record<Segment, number>>;
}

// ─────────────────────────────────────────────────────────────
// WALK-FORWARD CONFIG
// ─────────────────────────────────────────────────────────────

export interface WalkForwardConfig {
  /** Enable walk-forward validation. false = single full-period backtest. */
  enabled: boolean;

  /** Number of IS+OOS fold pairs. Minimum 3 for overfitting detection. */
  fold_count: number;

  /**
   * Fraction of each fold allocated to in-sample optimisation (0 < x < 1).
   * e.g. 0.7 = 70% IS, 30% OOS.
   */
  is_fraction: number;

  /**
   * Overfitting threshold: if OOS Sharpe < IS Sharpe × this value
   * on 3+ consecutive folds, run is marked overfit and halted.
   * Phase 4A hardcodes 0.5 — this field allows strategy-level override.
   * Default: 0.5
   */
  overfit_sharpe_ratio_threshold: number;

  /** Warmup bars at fold start and after seekTo(). Signal suppressed during warmup. */
  warmup_bars: number;

  /** Allow overnight positions (NRML). false = MIS forced exit at 15:29 IST. */
  allow_overnight: boolean;
}

// ─────────────────────────────────────────────────────────────
// STRATEGY METADATA
// ─────────────────────────────────────────────────────────────

export interface StrategyMetadata {
  /** Display name shown in reports and UI. */
  display_name: string;

  /** Freeform description of strategy logic. Not used in computation. */
  description?: string;

  /** Author or team identifier. */
  author?: string;

  /** Semantic version string. e.g. "1.0.0" */
  version: string;

  /** ISO 8601 timestamp of last parameter change. */
  last_modified_at: string;

  /**
   * Optional tags for filtering/grouping in strategy registry.
   * e.g. ["momentum", "intraday", "nifty50"]
   */
  tags?: string[];
}

// ─────────────────────────────────────────────────────────────
// STRATEGY DEFINITION (CRITICAL ROOT OBJECT)
// ─────────────────────────────────────────────────────────────

/**
 * StrategyDefinition is the canonical root object for Phase 5.
 * Every BacktestRunner call, paper trade session, and live session
 * is keyed to exactly one StrategyDefinition.
 *
 * This type is the source of truth for parameter_snapshot serialisation.
 * BacktestRunner serialises this to strategy_runs.parameter_snapshot JSONB
 * before the bar loop begins — never after.
 */
export interface StrategyDefinition {
  /** UUID v4. Stable across versions of same strategy. */
  strategy_id: string;

  /** Semantic version. Increment on any parameter change. */
  strategy_version: string;

  metadata: StrategyMetadata;

  /**
   * Primary trading instrument.
   * symbol_id references symbols table (Phase 3B).
   */
  symbol_id: string;

  /** Candle timeframe consumed by SignalEngine and RegimeEngine. */
  timeframe: Timeframe;

  segment: Segment;
  product_type: ProductType;

  /**
   * Indicator keys required by this strategy.
   * Format: "<name>_<period>" — must match keys emitted by IndicatorPipeline (Phase 5B).
   * SignalEngine validation at load time: all keys must be present in EnrichedBarEvent.indicators.
   * e.g. ["ema_20", "ema_50", "rsi_14", "atr_14"]
   */
  required_indicators: string[];

  /**
   * Opaque parameter map — strategy-specific numeric parameters.
   * Keys are strategy-defined (e.g. "rsi_oversold_threshold", "ema_fast_period").
   * All values must be numbers (integers or floats).
   * Serialised verbatim into parameter_snapshot.parameters.
   */
  parameters: Record<string, number>;

  sl_config: SLConfig;
  tp_config: TPConfig;

  /**
   * SL/TP conflict resolution — Phase 4C config override.
   * Default: "sl_wins" (Phase 4C hardcoded default).
   */
  sl_tp_conflict: SLTPConflict;

  risk_config: RiskConfig;
  cost_config: CostConfig;
  walk_forward_config: WalkForwardConfig;

  /**
   * Optional benchmark symbol_id for EquityCurveReport comparison.
   * Must exist in candles table (Phase 3B). Typically NIFTY 50 index symbol_id.
   */
  benchmark_symbol_id?: string;

  /**
   * Data gap handling for HistoricalDataFeed (Phase 4 M6).
   * "forward_fill": substitute last known close (default, conservative).
   * "skip": omit gapped bars entirely (may distort indicators).
   * "error": halt run on first gap (strictest, recommended for production).
   */
  data_gap_handling: 'forward_fill' | 'skip' | 'error';
}

// ─────────────────────────────────────────────────────────────
// PARAMETER SNAPSHOT — JSONB schema
// ─────────────────────────────────────────────────────────────

/**
 * ParameterSnapshot is the deterministic, serialisable projection of
 * StrategyDefinition written to strategy_runs.parameter_snapshot JSONB.
 *
 * PURPOSE: Reproducibility guarantee.
 * Given only strategy_runs.parameter_snapshot, any future BacktestRunner
 * call must produce byte-identical trade outputs over the same date range.
 *
 * RULES:
 * 1. Written ONCE at run start — never mutated after bar loop begins.
 * 2. Contains all parameters that affect trade logic, costs, or risk.
 * 3. Does NOT contain: run_id, timestamps, UI metadata, author, description.
 * 4. All numeric values stored as-is (no rounding).
 * 5. Maps serialised as plain objects (JSON does not support Map).
 *
 * BacktestRunner validates: JSON.stringify(toSnapshot(def)) produces same
 * output for same StrategyDefinition inputs (no non-deterministic fields).
 */
export interface ParameterSnapshot {
  /** strategy_id + strategy_version uniquely identifies the definition. */
  strategy_id: string;
  strategy_version: string;

  symbol_id: string;
  timeframe: Timeframe;
  segment: Segment;
  product_type: ProductType;

  /** Verbatim copy of StrategyDefinition.parameters. */
  parameters: Record<string, number>;

  /**
   * Indicator keys required — frozen at run start.
   * Sorted ascending for deterministic serialisation.
   */
  required_indicators: string[];

  sl_config: SLConfig;
  tp_config: TPConfig;
  sl_tp_conflict: SLTPConflict;

  risk_config: RiskConfig;
  cost_config: CostConfig;
  walk_forward_config: WalkForwardConfig;

  data_gap_handling: 'forward_fill' | 'skip' | 'error';

  /** benchmark_symbol_id if present, else null. Never omitted — always explicit. */
  benchmark_symbol_id: string | null;

  /**
   * Schema version of ParameterSnapshot itself.
   * Increment when snapshot structure changes — enables migration of
   * historical snapshots for re-analysis.
   * Current: 1
   */
  snapshot_schema_version: number;
}

// ─────────────────────────────────────────────────────────────
// SNAPSHOT SERIALISATION UTILITY TYPE
// ─────────────────────────────────────────────────────────────

/**
 * Input to toParameterSnapshot() — what BacktestRunner passes.
 * Separates the concerns: StrategyDefinition is the live object;
 * ParameterSnapshot is the immutable record.
 *
 * Implementation (Phase 5E): sort required_indicators, set benchmark to null
 * if absent, set snapshot_schema_version = 1. No other transformation.
 */
export type SnapshotInput = Readonly<StrategyDefinition>;

// ─────────────────────────────────────────────────────────────
// JSON SCHEMA — parameter_snapshot column validation
// ─────────────────────────────────────────────────────────────

/**
 * JSON Schema (draft-07) for strategy_runs.parameter_snapshot JSONB.
 * Applied as a Postgres CHECK constraint or application-level validation.
 *
 * Exported as a plain object for use with ajv or similar.
 */
export const PARAMETER_SNAPSHOT_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'artha/parameter_snapshot/v1',
  title: 'ParameterSnapshot',
  type: 'object',
  required: [
    'strategy_id',
    'strategy_version',
    'symbol_id',
    'timeframe',
    'segment',
    'product_type',
    'parameters',
    'required_indicators',
    'sl_config',
    'tp_config',
    'sl_tp_conflict',
    'risk_config',
    'cost_config',
    'walk_forward_config',
    'data_gap_handling',
    'benchmark_symbol_id',
    'snapshot_schema_version',
  ],
  additionalProperties: false,
  properties: {
    strategy_id: { type: 'string', format: 'uuid' },
    strategy_version: { type: 'string', minLength: 1 },
    symbol_id: { type: 'string', format: 'uuid' },
    timeframe: {
      type: 'string',
      enum: ['1m','3m','5m','10m','15m','30m','1h','2h','4h','1d','1w'],
    },
    segment: {
      type: 'string',
      enum: ['NSE_EQ','NFO_FUT','NFO_OPT','MCX_FUT','MCX_OPT'],
    },
    product_type: { type: 'string', enum: ['MIS','NRML','CNC'] },
    parameters: {
      type: 'object',
      additionalProperties: { type: 'number' },
    },
    required_indicators: {
      type: 'array',
      items: {
        type: 'string',
        // Pattern: <name>_<period> e.g. ema_20, rsi_14, atr_14, vwap_0
        pattern: '^[a-z][a-z0-9_]*_[0-9]+$',
      },
      uniqueItems: true,
    },
    sl_config: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { type: 'string', enum: ['fixed','trailing','time_based'] },
        value: { type: 'number', exclusiveMinimum: 0 },
        timeout_bars: { type: 'integer', minimum: 1 },
        trail_activation_offset: { type: 'number', minimum: 0 },
      },
      additionalProperties: false,
    },
    tp_config: {
      type: 'object',
      required: ['type', 'levels'],
      properties: {
        type: { type: 'string', enum: ['fixed','scaled','r_multiple'] },
        levels: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['fraction', 'value'],
            properties: {
              fraction: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
              value: { type: 'number', exclusiveMinimum: 0 },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    sl_tp_conflict: { type: 'string', enum: ['sl_wins','tp_wins'] },
    risk_config: {
      type: 'object',
      required: [
        'max_position_fraction',
        'daily_loss_limit_rupees',
        'max_drawdown_fraction',
        'max_gross_exposure_fraction',
        'max_net_exposure_fraction',
        'max_symbol_exposure_fraction',
        'max_concurrent_trades',
        'allow_pyramid',
        'span_margin_rates',
      ],
      properties: {
        max_position_fraction: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        daily_loss_limit_rupees: { type: 'number', exclusiveMinimum: 0 },
        max_drawdown_fraction: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        max_gross_exposure_fraction: { type: 'number', exclusiveMinimum: 0 },
        max_net_exposure_fraction: { type: 'number', exclusiveMinimum: 0 },
        max_symbol_exposure_fraction: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        max_concurrent_trades: { type: 'integer', minimum: 1 },
        allow_pyramid: { type: 'boolean' },
        span_margin_rates: {
          type: 'object',
          additionalProperties: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      additionalProperties: false,
    },
    cost_config: {
      type: 'object',
      required: ['brokerage_profile', 'slippage_model'],
      properties: {
        brokerage_profile: { type: 'string', enum: ['zero','flat_fee','percentage'] },
        brokerage_rate_by_segment: {
          type: 'object',
          additionalProperties: { type: 'number', minimum: 0 },
        },
        slippage_model: {
          type: 'string',
          enum: ['zero','fixed_paise','percentage','spread','volume_adjusted'],
        },
        fixed_slippage_paise_by_segment: {
          type: 'object',
          additionalProperties: { type: 'number', minimum: 0 },
        },
        slippage_pct_by_segment: {
          type: 'object',
          additionalProperties: { type: 'number', minimum: 0 },
        },
      },
      additionalProperties: false,
    },
    walk_forward_config: {
      type: 'object',
      required: [
        'enabled',
        'fold_count',
        'is_fraction',
        'overfit_sharpe_ratio_threshold',
        'warmup_bars',
        'allow_overnight',
      ],
      properties: {
        enabled: { type: 'boolean' },
        fold_count: { type: 'integer', minimum: 1 },
        is_fraction: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
        overfit_sharpe_ratio_threshold: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        warmup_bars: { type: 'integer', minimum: 0 },
        allow_overnight: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    data_gap_handling: { type: 'string', enum: ['forward_fill','skip','error'] },
    benchmark_symbol_id: { type: ['string', 'null'] },
    snapshot_schema_version: { type: 'integer', const: 1 },
  },
} as const;

// ─────────────────────────────────────────────────────────────
// PHASE 5A DELIVERY CHECKLIST
// ─────────────────────────────────────────────────────────────
//
// [x] EnrichedBarEvent extends IBarEvent — backward-compatible (indicators optional)
// [x] StrategyDefinition — root object; all Phase 4 consumer fields covered
// [x] ParameterSnapshot — deterministic; no non-reproducible fields
// [x] PARAMETER_SNAPSHOT_JSON_SCHEMA — validates parameter_snapshot JSONB column
// [x] RiskConfig — seeds risk_limits table (Phase 4E requirement)
// [x] WalkForwardConfig.warmup_bars — satisfies Phase 4H M7
// [x] data_gap_handling — satisfies Phase 4H M6
// [x] sl_tp_conflict — surfaces Phase 4C override contract
// [x] benchmark_symbol_id — satisfies Phase 4H M8 reference pointer
//
// NOT in Phase 5A (deferred):
// [ ] IIndicator, IndicatorBuffer, IndicatorPipeline → Phase 5B
// [ ] RegimeEngine, IRegimeClassifier → Phase 5C
// [ ] SignalEngine, ISignalEvaluator → Phase 5D
// [ ] StrategyRegistry → Phase 5E
// [ ] ParameterOptimiser → Phase 5F
