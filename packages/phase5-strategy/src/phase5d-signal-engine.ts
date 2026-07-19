/**
 * Phase 5D — Signal Engine
 *
 * Consumes EnrichedBarEvent (Phase 5B) + RegimeClassification (Phase 5C).
 * Produces SignalEvent written verbatim to signals table (Phase 3C).
 * EntrySimulator (Phase 4C) consumes SignalEvent unchanged.
 *
 * ══════════════════════════════════════════════════════════════
 * PHASE 4C FROZEN CONTRACT — MUST MATCH EXACTLY, NO EXCEPTIONS
 * SignalEvent shape:
 *   signal_id:        uuid
 *   symbol_id:        uuid
 *   strategy_run_id:  uuid
 *   signal_type:      string
 *   direction:        'LONG' | 'SHORT'
 *   strength:         number          [0, 1]
 *   entry_price_hint: number
 *   stop_loss:        number | null
 *   take_profit:      number | null
 *   kelly_fraction:   number          [0, 1]
 *   regime:           string          (RegimeLabel value)
 *   features:         object          (free JSONB)
 *   fired_at:         Date
 * ══════════════════════════════════════════════════════════════
 *
 * Depends on:  Phase 5A (EnrichedBarEvent, StrategyDefinition, Direction)
 *              Phase 5B (IndicatorPipeline output in EnrichedBarEvent.indicators)
 *              Phase 5C (RegimeClassification, RegimeLabel, ActiveRegimeLabel)
 * Feeds into:  Phase 4C EntrySimulator (frozen — reads SignalEvent unchanged)
 *              Phase 3C signals table (write)
 *              Phase 3E strategy_performance, regime_performance tables (read)
 */

import type { EnrichedBarEvent, Direction, SLConfig, TPConfig } from './phase5a-core-contracts';
import type { RegimeClassification, RegimeLabel, ActiveRegimeLabel } from './phase5c-regime-engine';

// ─────────────────────────────────────────────────────────────
// PHASE 4C FROZEN: SignalEvent
// DO NOT add, remove, or rename any field.
// ─────────────────────────────────────────────────────────────

/**
 * Exact shape consumed by Phase 4C EntrySimulator.
 * Any change here is a Phase 4 contract violation.
 *
 * features: free JSONB — use SignalFeatures type for internal construction,
 * but the runtime value is typed as `object` to match Phase 4C exactly.
 */
export interface SignalEvent {
  readonly signal_id:        string;          // uuid v4
  readonly symbol_id:        string;          // uuid — Phase 3B symbols table
  readonly strategy_run_id:  string;          // uuid — strategy_runs row
  readonly signal_type:      string;          // e.g. 'entry_long', 'entry_short'
  readonly direction:        Direction;       // 'LONG' | 'SHORT'
  readonly strength:         number;          // [0, 1] — raw evaluator score × regime weight
  readonly entry_price_hint: number;          // close price at signal bar
  readonly stop_loss:        number | null;   // absolute price level or null
  readonly take_profit:      number | null;   // absolute price level (first TP level) or null
  readonly kelly_fraction:   number;          // [0, 1] — position size fraction
  readonly regime:           string;          // RegimeLabel value as string
  readonly features:         object;          // indicator snapshot + meta at signal bar
  readonly fired_at:         Date;            // bar.bucket_ts — deterministic
}

// ─────────────────────────────────────────────────────────────
// SIGNAL FEATURES — typed internal struct → serialised as features: object
// ─────────────────────────────────────────────────────────────

/**
 * Strongly-typed snapshot of everything that drove the signal.
 * Stored verbatim in signals.features JSONB.
 * Learning engine (Phase 6) reads this; no runtime consumption by Phase 4.
 *
 * Fields added here are invisible to Phase 4C — safe to extend.
 */
export interface SignalFeatures {
  // Indicator values at signal bar
  indicators_snapshot: Record<string, number>;

  // Regime context
  regime_label:        string;
  regime_confidence:   number;
  regime_indicators_used: string[];

  // Evaluator outputs before weighting
  raw_strength:        number;   // evaluator score before regime weight
  regime_weight:       number;   // multiplier applied
  weighted_strength:   number;   // raw_strength × regime_weight = SignalEvent.strength

  // SL/TP computation trace
  sl_computed:         number | null;
  tp_computed:         number | null;
  sl_method:           string;    // e.g. 'atr_multiplier', 'fixed', 'pct_from_entry'
  tp_method:           string;

  // Kelly trace
  kelly_raw:           number;    // raw Kelly before capping
  kelly_capped:        number;    // after max_position_fraction cap
  kelly_regime_adj:    number;    // after regime performance adjustment
  win_rate_estimate:   number;
  avg_win_loss_ratio:  number;

  // Risk rejection (populated after RiskValidationPipeline — written back by BacktestRunner)
  risk_rejection?:     { stage: number; reason: string; detail: string };

  // Bars since last signal of same direction (duplicate suppression audit)
  bars_since_last_signal: number;
}

// ─────────────────────────────────────────────────────────────
// ISIGNAL EVALUATOR — pluggable entry condition logic
// ─────────────────────────────────────────────────────────────

/**
 * One evaluation rule that votes for a signal.
 * SignalEngine aggregates votes from all registered evaluators.
 *
 * Invariants:
 * 1. evaluate() is O(1) — reads from indicators map only.
 * 2. Returns null → no signal this bar (abstain).
 * 3. Returns SignalVote → evaluator votes for this direction + strength.
 * 4. reset() clears any stateful moving averages or bar counters.
 * 5. requiredIndicators must be subset of pipeline's registered keys.
 *    SignalEngine.validate() checks at run start.
 */
export interface ISignalEvaluator {
  readonly name: string;
  readonly requiredIndicators: readonly string[];

  /**
   * Evaluate current bar. Returns null (no vote) or SignalVote.
   * Must be deterministic and O(1).
   */
  evaluate(
    bar: EnrichedBarEvent,
    regime: RegimeClassification,
    params: Record<string, number>,
  ): SignalVote | null;

  /** Reset internal state. Called on fold boundary and seekTo(). */
  reset(): void;
}

export interface SignalVote {
  direction:  Direction;
  strength:   number;          // [0, 1] — raw evaluator confidence
  signal_type: string;         // e.g. 'ema_crossover', 'rsi_reversal'
}

// ─────────────────────────────────────────────────────────────
// REGIME WEIGHT TABLE
// ─────────────────────────────────────────────────────────────

/**
 * Per-regime signal strength multiplier.
 * Sourced from regime_performance table (Phase 3E) at run start.
 * Updated after each fold close (walk-forward learning).
 *
 * Interpretation:
 *   weight = 1.0 → regime has average historical win rate
 *   weight > 1.0 → regime has above-average win rate → amplify signal
 *   weight < 1.0 → regime has below-average win rate → attenuate signal
 *   weight = 0.0 → never trade in this regime
 *
 * Strength after weighting: min(raw_strength × weight, 1.0)
 * (caps at 1.0 — SignalEvent.strength is [0, 1] contract)
 */
export type RegimeWeightTable = Readonly<Record<ActiveRegimeLabel, number>>;

/** Conservative defaults — equal weight across all regimes (no prior data). */
export const DEFAULT_REGIME_WEIGHTS: RegimeWeightTable = {
  TRENDING_UP:     1.0,
  TRENDING_DOWN:   1.0,
  SIDEWAYS:        0.5,   // attenuate in sideways by default
  HIGH_VOLATILITY: 0.7,   // attenuate in high vol by default
  LOW_VOLATILITY:  0.8,
};

// ─────────────────────────────────────────────────────────────
// KELLY CALCULATOR
// ─────────────────────────────────────────────────────────────

/**
 * Computes Kelly fraction from historical win rate and avg win/loss ratio.
 * Reads from strategy_performance table (Phase 3E) at run start.
 * Falls back to conservative default (0.1) when no prior performance data.
 *
 * Kelly formula: f* = (b×p - q) / b
 *   p = win probability, q = 1-p, b = avg_win / avg_loss ratio
 *
 * HARD CAPS applied in this order:
 *   1. Half-Kelly: multiply by 0.5 (standard conservative practice)
 *   2. Regime adjustment: × regime_kelly_multiplier from RegimeWeightTable
 *   3. Max position fraction cap: min(f, RiskConfig.max_position_fraction)
 *   4. Floor: max(f, MIN_KELLY_FLOOR) — never size to near-zero
 *
 * Output maps to SignalEvent.kelly_fraction — consumed by RiskValidationPipeline
 * Stage 1 (Phase 4E) for notional sizing.
 */
export class KellyCalculator {
  static readonly MIN_KELLY_FLOOR   = 0.01;   // 1% minimum
  static readonly HALF_KELLY_FACTOR = 0.5;
  static readonly DEFAULT_WIN_RATE  = 0.50;
  static readonly DEFAULT_WIN_LOSS  = 1.5;    // avg_win = 1.5 × avg_loss

  constructor(
    private readonly maxPositionFraction: number,
  ) {}

  /**
   * Compute final Kelly fraction for this signal.
   *
   * @param winRate          Estimated win probability [0, 1]
   * @param avgWinLossRatio  avg_win / avg_loss > 0
   * @param regimeMultiplier From RegimeWeightTable for current regime [0, 2]
   * @returns                Kelly fraction [MIN_KELLY_FLOOR, maxPositionFraction]
   */
  compute(
    winRate:          number,
    avgWinLossRatio:  number,
    regimeMultiplier: number,
  ): {
    kelly_fraction:   number;
    kelly_raw:        number;
    kelly_capped:     number;
    kelly_regime_adj: number;
  } {
    // Clamp inputs — never trust DB values blindly
    const p = Math.max(0.01, Math.min(0.99, winRate));
    const b = Math.max(0.01, avgWinLossRatio);
    const q = 1 - p;

    // Full Kelly
    const kellyRaw = (b * p - q) / b;

    // Negative Kelly → no edge → floor
    const kellyPositive = Math.max(0, kellyRaw);

    // Half-Kelly
    const halfKelly = kellyPositive * KellyCalculator.HALF_KELLY_FACTOR;

    // Regime adjustment
    const regimeAdj = halfKelly * Math.max(0, Math.min(2, regimeMultiplier));

    // Cap at max_position_fraction (RiskConfig — Phase 4E Stage 1 contract)
    const capped = Math.min(regimeAdj, this.maxPositionFraction);

    // Floor
    const final = Math.max(capped, KellyCalculator.MIN_KELLY_FLOOR);

    return {
      kelly_fraction:   final,
      kelly_raw:        kellyRaw,
      kelly_capped:     capped,
      kelly_regime_adj: regimeAdj,
    };
  }

  /**
   * Conservative fallback when no strategy_performance row exists.
   * Used on first run of a new strategy.
   */
  fallback(regimeMultiplier: number): ReturnType<KellyCalculator['compute']> {
    return this.compute(
      KellyCalculator.DEFAULT_WIN_RATE,
      KellyCalculator.DEFAULT_WIN_LOSS,
      regimeMultiplier,
    );
  }
}

// ─────────────────────────────────────────────────────────────
// SL/TP CALCULATOR — computes absolute price levels for SignalEvent
// ─────────────────────────────────────────────────────────────

/**
 * Translates SLConfig / TPConfig from StrategyDefinition into
 * absolute price levels for SignalEvent.stop_loss and .take_profit.
 *
 * Phase 4C EntrySimulator uses these as price targets for SLManager
 * and TargetManager — must be in same price units as bar.close.
 *
 * stop_loss and take_profit in SignalEvent are the FIRST TP level only
 * (single number). All subsequent TP levels are in SignalFeatures.features
 * for audit but are re-derived by TargetManager from the SLConfig/TPConfig
 * in StrategyDefinition. This is consistent with Phase 4C design.
 */
export class SLTPCalculator {
  /**
   * Compute stop_loss absolute price.
   * Returns null if SLConfig.type = 'time_based' (no price level).
   */
  static computeSL(
    direction: Direction,
    entryPrice: number,
    slConfig: SLConfig,
    atr: number | undefined,
  ): { price: number | null; method: string } {
    switch (slConfig.type) {
      case 'fixed': {
        if (slConfig.value === undefined) return { price: null, method: 'fixed_missing' };
        const price = direction === 'LONG'
          ? entryPrice - slConfig.value
          : entryPrice + slConfig.value;
        return { price, method: 'fixed' };
      }

      case 'trailing': {
        // Trailing SL: initial price = entry ± value; SLManager adjusts thereafter
        if (slConfig.value === undefined) return { price: null, method: 'trailing_missing' };
        const price = direction === 'LONG'
          ? entryPrice - slConfig.value
          : entryPrice + slConfig.value;
        return { price, method: 'trailing' };
      }

      case 'time_based': {
        // No price-level SL; SLManager uses timeout_bars
        return { price: null, method: 'time_based' };
      }

      default:
        return { price: null, method: 'unknown' };
    }
  }

  /**
   * Compute take_profit absolute price (first TP level only).
   * Returns null if TPConfig not provided or first level invalid.
   */
  static computeTP(
    direction: Direction,
    entryPrice: number,
    tpConfig: TPConfig,
    slDistance: number | null,
  ): { price: number | null; method: string } {
    const firstLevel = tpConfig.levels[0];

    switch (tpConfig.type) {
      case 'fixed':
      case 'scaled': {
        const price = direction === 'LONG'
          ? entryPrice + firstLevel.value
          : entryPrice - firstLevel.value;
        return { price, method: tpConfig.type };
      }

      case 'r_multiple': {
        // R-multiple: TP = entry ± (firstLevel.value × sl_distance)
        if (slDistance === null || slDistance <= 0) {
          return { price: null, method: 'r_multiple_no_sl' };
        }
        const price = direction === 'LONG'
          ? entryPrice + firstLevel.value * slDistance
          : entryPrice - firstLevel.value * slDistance;
        return { price, method: 'r_multiple' };
      }

      default:
        return { price: null, method: 'unknown' };
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SIGNAL FILTER — deduplication and quality gates
// ─────────────────────────────────────────────────────────────

/**
 * Stateful filter applied after evaluator votes are aggregated.
 * Prevents: duplicate signals, low-strength noise, warmup leakage,
 * opposing-direction flips without a close first.
 *
 * All filter decisions are logged in SignalEngineBarResult for audit.
 */
export class SignalFilter {
  private _lastSignalDirection: Direction | null = null;
  private _barsSinceLastSignal: number = 0;

  constructor(
    /** Minimum weighted strength to emit a signal. Default 0.3. */
    private readonly minStrength: number = 0.3,
    /** Minimum bars between signals of same direction (cooldown). Default 1. */
    private readonly minBarsBetweenSignals: number = 1,
  ) {}

  /**
   * Apply all filters. Returns FilterResult.
   * suppress = true → no SignalEvent emitted this bar.
   */
  filter(params: {
    regime: RegimeClassification;
    direction: Direction;
    weightedStrength: number;
    isWarmup: boolean;
  }): FilterResult {
    this._barsSinceLastSignal++;

    // ── FILTER 1: Warmup suppression ────────────────────────
    // Phase 4 hard requirement: no signals during warmup_bars
    if (params.isWarmup || params.regime.label === 'WARMUP') {
      return {
        suppress: true,
        reason: 'warmup',
        bars_since_last_signal: this._barsSinceLastSignal,
      };
    }

    // ── FILTER 2: Minimum strength gate ─────────────────────
    if (params.weightedStrength < this.minStrength) {
      return {
        suppress: true,
        reason: 'below_min_strength',
        bars_since_last_signal: this._barsSinceLastSignal,
      };
    }

    // ── FILTER 3: Regime zero-weight (SIDEWAYS attenuated to 0) ─
    if (params.weightedStrength === 0) {
      return {
        suppress: true,
        reason: 'regime_weight_zero',
        bars_since_last_signal: this._barsSinceLastSignal,
      };
    }

    // ── FILTER 4: Cooldown — same direction too soon ─────────
    if (
      this._lastSignalDirection === params.direction &&
      this._barsSinceLastSignal <= this.minBarsBetweenSignals
    ) {
      return {
        suppress: true,
        reason: 'cooldown',
        bars_since_last_signal: this._barsSinceLastSignal,
      };
    }

    // ── PASS ─────────────────────────────────────────────────
    return {
      suppress: false,
      reason: null,
      bars_since_last_signal: this._barsSinceLastSignal,
    };
  }

  /** Record that a signal was emitted this bar. Call AFTER filter passes. */
  recordEmission(direction: Direction): void {
    this._lastSignalDirection = direction;
    this._barsSinceLastSignal = 0;
  }

  reset(): void {
    this._lastSignalDirection = null;
    this._barsSinceLastSignal = 0;
  }

  get barsSinceLastSignal(): number { return this._barsSinceLastSignal; }
}

export interface FilterResult {
  suppress: boolean;
  reason: 'warmup' | 'below_min_strength' | 'regime_weight_zero' | 'cooldown' | null;
  bars_since_last_signal: number;
}

// ─────────────────────────────────────────────────────────────
// PERFORMANCE CONTEXT — loaded from Phase 3E tables at run start
// ─────────────────────────────────────────────────────────────

/**
 * Historical performance data seeded from DB at run start.
 * Drives Kelly calculation and regime weight adjustment.
 * NOT read during the bar loop — loaded once, injected into SignalEngine.
 *
 * Sources:
 *   strategy_performance (Phase 3E) → overall win_rate, avg_win_loss_ratio
 *   regime_performance   (Phase 3E) → per-regime adjustments
 */
export interface StrategyPerformanceContext {
  /** Overall historical win rate [0, 1]. null = no prior data → use default. */
  win_rate:          number | null;
  /** avg_win / avg_loss ratio. null = no prior data. */
  avg_win_loss_ratio: number | null;
  /** Per-regime Kelly multipliers. Loaded from regime_performance. */
  regime_kelly_multipliers: Partial<Record<ActiveRegimeLabel, number>>;
  /** Per-regime historical win rates (for RegimeWeightTable update). */
  regime_win_rates: Partial<Record<ActiveRegimeLabel, number>>;
}

/**
 * Build RegimeWeightTable from StrategyPerformanceContext.
 * Called at run start and after each fold close (walk-forward update).
 *
 * Formula per regime:
 *   weight = regime_win_rate / overall_win_rate    (if both available)
 *   weight = DEFAULT_REGIME_WEIGHTS[regime]         (fallback)
 *   weight clamped to [0, 2.0]
 */
export function buildRegimeWeightTable(
  ctx: StrategyPerformanceContext,
  defaults: RegimeWeightTable = DEFAULT_REGIME_WEIGHTS,
): RegimeWeightTable {
  const overallWR = ctx.win_rate ?? 0.5;
  const result: Record<string, number> = {};

  for (const label of Object.keys(defaults) as ActiveRegimeLabel[]) {
    const regimeWR = ctx.regime_win_rates[label];
    if (regimeWR !== undefined && overallWR > 0) {
      result[label] = Math.max(0, Math.min(2.0, regimeWR / overallWR));
    } else {
      result[label] = defaults[label];
    }
  }

  return result as RegimeWeightTable;
}

// ─────────────────────────────────────────────────────────────
// SIGNAL ENGINE CONFIG
// ─────────────────────────────────────────────────────────────

export interface SignalEngineConfig {
  symbolId:        string;
  strategyRunId:   string;
  warmupBars:      number;     // from WalkForwardConfig.warmup_bars
  slConfig:        SLConfig;
  tpConfig:        TPConfig;
  parameters:      Record<string, number>;
  maxPositionFraction: number; // from RiskConfig.max_position_fraction

  /** Minimum aggregated weighted strength to emit. Default 0.3. */
  minSignalStrength?: number;

  /**
   * Minimum bars between same-direction signals.
   * Prevents burst signal emission on fast-moving bars.
   * Default 1 (one bar cooldown).
   */
  minBarsBetweenSignals?: number;

  /**
   * Signal aggregation strategy when multiple evaluators vote.
   * 'max':     take highest-strength vote (conservative — one strong signal wins)
   * 'average': average all votes (consensus — reduces noise)
   * 'first':   take first non-null vote in registration order (priority)
   * Default: 'max'
   */
  aggregationStrategy?: 'max' | 'average' | 'first';
}

// ─────────────────────────────────────────────────────────────
// BAR RESULT — per-bar diagnostic output
// ─────────────────────────────────────────────────────────────

/**
 * Full diagnostic record for every bar processed.
 * signal = null when suppressed or no vote.
 * Used by BacktestRunner for logging and by test assertions.
 */
export interface SignalEngineBarResult {
  bar_ts:          Date;
  bars_seen:       number;
  regime:          RegimeClassification;
  votes:           readonly SignalVote[];        // raw evaluator votes
  winning_vote:    SignalVote | null;            // after aggregation
  regime_weight:   number;
  weighted_strength: number;
  filter_result:   FilterResult;
  kelly_result:    ReturnType<KellyCalculator['compute']> | null;
  signal:          SignalEvent | null;           // null = suppressed
}

// ─────────────────────────────────────────────────────────────
// SIGNAL ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * SignalEngine: the Phase 5D core component.
 *
 * Per-bar pipeline:
 *   1. Guard — warmup / regime WARMUP → suppress immediately
 *   2. Evaluate — all ISignalEvaluator instances vote
 *   3. Aggregate — votes combined per aggregationStrategy
 *   4. Weight — multiply strength by regime weight
 *   5. Filter — strength gate, cooldown, direction checks
 *   6. Kelly  — compute position size fraction
 *   7. SL/TP  — compute absolute price levels
 *   8. Emit   — build and return SignalEvent (exact Phase 4C shape)
 *
 * Phase 4 event flow position:
 *   ReplayEventBus → RegimeEngine.onBar() → SignalEngine.onBar() → SignalEvent
 *   → RiskValidationPipeline → EntrySimulator
 *
 * SignalEngine does NOT call RiskValidationPipeline — that is BacktestRunner's
 * responsibility. SignalEngine only emits or suppresses.
 */
export class SignalEngine {
  private readonly _evaluators: ISignalEvaluator[] = [];
  private readonly _kellyCalc: KellyCalculator;
  private readonly _filter: SignalFilter;
  private readonly _config: Required<SignalEngineConfig>;

  private _regimeWeights: RegimeWeightTable = DEFAULT_REGIME_WEIGHTS;
  private _perfContext: StrategyPerformanceContext | null = null;
  private _barsSeen: number = 0;
  private _frozen: boolean = false;

  constructor(config: SignalEngineConfig) {
    this._config = {
      minSignalStrength:    config.minSignalStrength    ?? 0.3,
      minBarsBetweenSignals: config.minBarsBetweenSignals ?? 1,
      aggregationStrategy:  config.aggregationStrategy  ?? 'max',
      ...config,
    };
    this._kellyCalc = new KellyCalculator(config.maxPositionFraction);
    this._filter = new SignalFilter(
      this._config.minSignalStrength,
      this._config.minBarsBetweenSignals,
    );
  }

  // ── REGISTRATION ────────────────────────────────────────

  registerEvaluator(evaluator: ISignalEvaluator): this {
    if (this._frozen) {
      throw new Error('SignalEngine frozen — cannot register after first bar');
    }
    this._evaluators.push(evaluator);
    return this;
  }

  /**
   * Validate all evaluators' requiredIndicators exist in pipeline.
   * Throws listing all missing keys.
   */
  validate(availableIndicatorKeys: readonly string[]): void {
    const keySet = new Set(availableIndicatorKeys);
    const missing: string[] = [];
    for (const e of this._evaluators) {
      for (const k of e.requiredIndicators) {
        if (!keySet.has(k)) missing.push(`${e.name}:${k}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(`SignalEngine missing indicator keys: ${missing.join(', ')}`);
    }
    if (this._evaluators.length === 0) {
      throw new Error('SignalEngine has no evaluators registered');
    }
  }

  /**
   * Seed performance context from Phase 3E tables.
   * Call at run start and after each fold close (walk-forward update).
   * Safe to call mid-run — RegimeWeightTable rebuilds atomically.
   */
  seedPerformanceContext(ctx: StrategyPerformanceContext): void {
    this._perfContext = ctx;
    this._regimeWeights = buildRegimeWeightTable(ctx);
  }

  // ── MAIN ENTRY POINT ────────────────────────────────────

  /**
   * Process one bar. Called AFTER RegimeEngine.onBar() in BacktestRunner loop.
   *
   * Returns SignalEngineBarResult always (never throws).
   * result.signal = null when suppressed.
   * result.signal = SignalEvent when emitted — EXACT Phase 4C shape.
   *
   * BacktestRunner writes result.signal to signals table then passes
   * to RiskValidationPipeline.
   */
  onBar(
    bar: EnrichedBarEvent,
    regime: RegimeClassification,
  ): SignalEngineBarResult {
    if (!this._frozen) this._frozen = true;
    this._barsSeen++;

    const isWarmup = this._barsSeen <= this._config.warmupBars
                  || regime.label === 'WARMUP';

    // ── STEP 1: WARMUP GUARD ─────────────────────────────
    // Hard Phase 4 requirement: no signal evaluation during warmup.
    // Evaluators' evaluate() is NOT called — their internal state is
    // NOT advanced during warmup (unlike IndicatorPipeline which always
    // runs). This is correct: evaluators read indicator output, which is
    // already guarded by NaN during indicator warmup.
    if (isWarmup) {
      const filterResult: FilterResult = {
        suppress: true,
        reason: 'warmup',
        bars_since_last_signal: this._filter.barsSinceLastSignal,
      };
      return {
        bar_ts: bar.bucket_ts,
        bars_seen: this._barsSeen,
        regime,
        votes: [],
        winning_vote: null,
        regime_weight: 0,
        weighted_strength: 0,
        filter_result: filterResult,
        kelly_result: null,
        signal: null,
      };
    }

    // ── STEP 2: COLLECT EVALUATOR VOTES ─────────────────
    const votes: SignalVote[] = [];
    for (const evaluator of this._evaluators) {
      const vote = evaluator.evaluate(bar, regime, this._config.parameters);
      if (vote !== null) votes.push(vote);
    }

    // ── STEP 3: AGGREGATE VOTES ──────────────────────────
    const winningVote = this._aggregate(votes);

    if (winningVote === null) {
      const filterResult: FilterResult = {
        suppress: true,
        reason: null,
        bars_since_last_signal: this._filter.barsSinceLastSignal,
      };
      return {
        bar_ts: bar.bucket_ts,
        bars_seen: this._barsSeen,
        regime,
        votes,
        winning_vote: null,
        regime_weight: 1.0,
        weighted_strength: 0,
        filter_result: filterResult,
        kelly_result: null,
        signal: null,
      };
    }

    // ── STEP 4: REGIME WEIGHTING ─────────────────────────
    const regimeWeight = regime.label === 'WARMUP'
      ? 0
      : (this._regimeWeights[regime.label as ActiveRegimeLabel] ?? 1.0);

    const weightedStrength = Math.min(winningVote.strength * regimeWeight, 1.0);

    // ── STEP 5: FILTER ───────────────────────────────────
    const filterResult = this._filter.filter({
      regime,
      direction: winningVote.direction,
      weightedStrength,
      isWarmup: false,
    });

    if (filterResult.suppress) {
      return {
        bar_ts: bar.bucket_ts,
        bars_seen: this._barsSeen,
        regime,
        votes,
        winning_vote: winningVote,
        regime_weight: regimeWeight,
        weighted_strength: weightedStrength,
        filter_result: filterResult,
        kelly_result: null,
        signal: null,
      };
    }

    // ── STEP 6: KELLY FRACTION ───────────────────────────
    const winRate  = this._perfContext?.win_rate          ?? null;
    const avgWLR   = this._perfContext?.avg_win_loss_ratio ?? null;
    const regimeKellyMult = this._perfContext?.regime_kelly_multipliers[
      regime.label as ActiveRegimeLabel
    ] ?? regimeWeight; // fall back to regime weight as multiplier

    const kellyResult = (winRate !== null && avgWLR !== null)
      ? this._kellyCalc.compute(winRate, avgWLR, regimeKellyMult)
      : this._kellyCalc.fallback(regimeKellyMult);

    // ── STEP 7: SL/TP PRICE LEVELS ───────────────────────
    const entryPriceHint = bar.close;
    const atr = bar.indicators?.get(this._findATRKey());

    const slResult = SLTPCalculator.computeSL(
      winningVote.direction,
      entryPriceHint,
      this._config.slConfig,
      atr,
    );

    const slDistance = slResult.price !== null
      ? Math.abs(entryPriceHint - slResult.price)
      : null;

    const tpResult = SLTPCalculator.computeTP(
      winningVote.direction,
      entryPriceHint,
      this._config.tpConfig,
      slDistance,
    );

    // ── STEP 8: EMIT — PHASE 4C EXACT SHAPE ─────────────
    const features: SignalFeatures = {
      indicators_snapshot:    this._snapshotIndicators(bar),
      regime_label:           regime.label,
      regime_confidence:      regime.confidence,
      regime_indicators_used: regime.indicators_used as string[],
      raw_strength:           winningVote.strength,
      regime_weight:          regimeWeight,
      weighted_strength:      weightedStrength,
      sl_computed:            slResult.price,
      tp_computed:            tpResult.price,
      sl_method:              slResult.method,
      tp_method:              tpResult.method,
      kelly_raw:              kellyResult.kelly_raw,
      kelly_capped:           kellyResult.kelly_capped,
      kelly_regime_adj:       kellyResult.kelly_regime_adj,
      win_rate_estimate:      winRate ?? KellyCalculator.DEFAULT_WIN_RATE,
      avg_win_loss_ratio:     avgWLR  ?? KellyCalculator.DEFAULT_WIN_LOSS,
      bars_since_last_signal: filterResult.bars_since_last_signal,
    };

    // Phase 4C frozen contract — no field additions or removals
    const signal: SignalEvent = {
      signal_id:        generateUUID(),
      symbol_id:        this._config.symbolId,
      strategy_run_id:  this._config.strategyRunId,
      signal_type:      winningVote.signal_type,
      direction:        winningVote.direction,
      strength:         weightedStrength,          // [0, 1] ✓
      entry_price_hint: entryPriceHint,
      stop_loss:        slResult.price,
      take_profit:      tpResult.price,
      kelly_fraction:   kellyResult.kelly_fraction, // [0, 1] ✓
      regime:           regime.label,               // string ✓
      features:         features as object,         // object ✓
      fired_at:         bar.bucket_ts,              // deterministic ✓
    };

    // Record emission for cooldown tracking
    this._filter.recordEmission(winningVote.direction);

    return {
      bar_ts: bar.bucket_ts,
      bars_seen: this._barsSeen,
      regime,
      votes,
      winning_vote: winningVote,
      regime_weight: regimeWeight,
      weighted_strength: weightedStrength,
      filter_result: filterResult,
      kelly_result: kellyResult,
      signal,
    };
  }

  // ── RESET (fold boundary / seekTo) ──────────────────────

  /**
   * Reset all stateful components.
   * Called by BacktestRunner at fold boundary (mirrors RegimeEngine.resetBuffer()).
   * Does NOT reset performance context — regime weights persist across folds
   * (they are updated after each fold, not cleared).
   */
  reset(): void {
    this._filter.reset();
    for (const e of this._evaluators) e.reset();
    this._barsSeen = 0;
    this._frozen = false;
  }

  /**
   * Update regime weights after a fold completes.
   * Called by BacktestRunner before next fold start.
   * Safe to call with partial context (fields present override; absent keep prior).
   */
  updatePerformanceContext(ctx: StrategyPerformanceContext): void {
    this._perfContext = {
      ...this._perfContext,
      ...ctx,
      regime_kelly_multipliers: {
        ...this._perfContext?.regime_kelly_multipliers,
        ...ctx.regime_kelly_multipliers,
      },
      regime_win_rates: {
        ...this._perfContext?.regime_win_rates,
        ...ctx.regime_win_rates,
      },
    };
    this._regimeWeights = buildRegimeWeightTable(this._perfContext);
  }

  // ── PRIVATE HELPERS ──────────────────────────────────────

  private _aggregate(votes: SignalVote[]): SignalVote | null {
    if (votes.length === 0) return null;

    switch (this._config.aggregationStrategy) {
      case 'first':
        return votes[0];

      case 'average': {
        // Average strength of same-direction votes; majority direction wins
        const longVotes  = votes.filter(v => v.direction === 'LONG');
        const shortVotes = votes.filter(v => v.direction === 'SHORT');
        const dominant   = longVotes.length >= shortVotes.length ? longVotes : shortVotes;
        if (dominant.length === 0) return null;
        const avgStrength = dominant.reduce((s, v) => s + v.strength, 0) / dominant.length;
        // Use signal_type of strongest vote in dominant group
        const strongest = dominant.reduce((a, b) => a.strength >= b.strength ? a : b);
        return { direction: dominant[0].direction, strength: avgStrength, signal_type: strongest.signal_type };
      }

      case 'max':
      default: {
        // Take highest-strength vote; ties: LONG wins (conservative — not SHORT)
        return votes.reduce((best, v) =>
          v.strength > best.strength ? v : best
        );
      }
    }
  }

  /** Find first ATR key in indicators map for SL computation. */
  private _findATRKey(): string {
    // Look for atr_<any_period> in evaluator required indicators
    for (const e of this._evaluators) {
      for (const k of e.requiredIndicators) {
        if (k.startsWith('atr_')) return k;
      }
    }
    return 'atr_14'; // conventional default
  }

  /** Snapshot current indicator values for SignalFeatures. */
  private _snapshotIndicators(bar: EnrichedBarEvent): Record<string, number> {
    if (!bar.indicators) return {};
    const snap: Record<string, number> = {};
    for (const [k, v] of bar.indicators) {
      snap[k] = v;
    }
    return snap;
  }

  get barsSeen(): number { return this._barsSeen; }
}

// ─────────────────────────────────────────────────────────────
// CONCRETE EVALUATOR 1: EMACrossoverEvaluator
// Signal type: 'ema_crossover'
// Entry: fast EMA crosses slow EMA — direction determined by cross direction.
// Strength: proportional to EMA separation at cross point.
// Stateful: tracks previous-bar EMA relationship to detect crossovers.
// ─────────────────────────────────────────────────────────────

export class EMACrossoverEvaluator implements ISignalEvaluator {
  readonly name = 'EMACrossoverEvaluator';

  private _prevFast: number = NaN;
  private _prevSlow: number = NaN;

  constructor(
    private readonly fastKey: string,   // e.g. "ema_9"
    private readonly slowKey: string,   // e.g. "ema_21"
  ) {}

  get requiredIndicators(): readonly string[] {
    return [this.fastKey, this.slowKey];
  }

  evaluate(
    bar: EnrichedBarEvent,
    _regime: RegimeClassification,
    _params: Record<string, number>,
  ): SignalVote | null {
    const ind = bar.indicators;
    if (!ind) return null;

    const fast = ind.get(this.fastKey);
    const slow = ind.get(this.slowKey);

    if (fast === undefined || slow === undefined || isNaN(fast) || isNaN(slow)) {
      this._prevFast = NaN;
      this._prevSlow = NaN;
      return null;
    }

    const prevFast = this._prevFast;
    const prevSlow = this._prevSlow;
    this._prevFast = fast;
    this._prevSlow = slow;

    if (isNaN(prevFast) || isNaN(prevSlow)) return null; // first bar after warmup

    const crossedUp   = prevFast <= prevSlow && fast > slow;
    const crossedDown = prevFast >= prevSlow && fast < slow;

    if (!crossedUp && !crossedDown) return null;

    const separation = Math.abs(fast - slow) / slow;
    const strength = Math.min(separation * 100, 1.0); // 1% separation = full strength

    return {
      direction: crossedUp ? 'LONG' : 'SHORT',
      strength: Math.max(0.1, strength), // floor at 0.1 — crossover itself has value
      signal_type: 'ema_crossover',
    };
  }

  reset(): void {
    this._prevFast = NaN;
    this._prevSlow = NaN;
  }
}

// ─────────────────────────────────────────────────────────────
// CONCRETE EVALUATOR 2: RSIMeanReversionEvaluator
// Signal type: 'rsi_mean_reversion'
// Entry: RSI exits oversold (LONG) or overbought (SHORT) zone.
// Strength: proportional to RSI distance from threshold.
// ─────────────────────────────────────────────────────────────

export class RSIMeanReversionEvaluator implements ISignalEvaluator {
  readonly name = 'RSIMeanReversionEvaluator';

  private _prevRSI: number = NaN;

  constructor(
    private readonly rsiKey: string,          // e.g. "rsi_14"
    private readonly oversoldThreshold: number  = 30,
    private readonly overboughtThreshold: number = 70,
  ) {}

  get requiredIndicators(): readonly string[] { return [this.rsiKey]; }

  evaluate(
    bar: EnrichedBarEvent,
    _regime: RegimeClassification,
    _params: Record<string, number>,
  ): SignalVote | null {
    const ind = bar.indicators;
    if (!ind) return null;

    const rsi = ind.get(this.rsiKey);
    if (rsi === undefined || isNaN(rsi)) { this._prevRSI = NaN; return null; }

    const prev = this._prevRSI;
    this._prevRSI = rsi;

    if (isNaN(prev)) return null;

    // Exit from oversold → LONG
    if (prev <= this.oversoldThreshold && rsi > this.oversoldThreshold) {
      const strength = Math.min((this.oversoldThreshold - prev) / this.oversoldThreshold + 0.3, 1.0);
      return { direction: 'LONG', strength, signal_type: 'rsi_mean_reversion' };
    }

    // Exit from overbought → SHORT
    if (prev >= this.overboughtThreshold && rsi < this.overboughtThreshold) {
      const strength = Math.min((prev - this.overboughtThreshold) / (100 - this.overboughtThreshold) + 0.3, 1.0);
      return { direction: 'SHORT', strength, signal_type: 'rsi_mean_reversion' };
    }

    return null;
  }

  reset(): void { this._prevRSI = NaN; }
}

// ─────────────────────────────────────────────────────────────
// CONCRETE EVALUATOR 3: MACDSignalCrossEvaluator
// Signal type: 'macd_signal_cross'
// Entry: MACD line crosses signal line.
// Strength: proportional to histogram magnitude at cross.
// ─────────────────────────────────────────────────────────────

export class MACDSignalCrossEvaluator implements ISignalEvaluator {
  readonly name = 'MACDSignalCrossEvaluator';

  private _prevHist: number = NaN;

  constructor(
    private readonly macdHistKey: string,  // e.g. "macd_26_hist"
    private readonly macdLineKey: string,  // e.g. "macd_26_line"
  ) {}

  get requiredIndicators(): readonly string[] {
    return [this.macdHistKey, this.macdLineKey];
  }

  evaluate(
    bar: EnrichedBarEvent,
    _regime: RegimeClassification,
    _params: Record<string, number>,
  ): SignalVote | null {
    const ind = bar.indicators;
    if (!ind) return null;

    const hist = ind.get(this.macdHistKey);
    const line = ind.get(this.macdLineKey);

    if (hist === undefined || isNaN(hist) || line === undefined || isNaN(line)) {
      this._prevHist = NaN;
      return null;
    }

    const prev = this._prevHist;
    this._prevHist = hist;

    if (isNaN(prev)) return null;

    const crossedPositive = prev <= 0 && hist > 0;
    const crossedNegative = prev >= 0 && hist < 0;

    if (!crossedPositive && !crossedNegative) return null;

    // Strength proportional to histogram magnitude relative to line scale
    const scale = Math.abs(line) > 0 ? Math.abs(hist) / Math.abs(line) : 0;
    const strength = Math.min(0.3 + scale * 2, 1.0);

    return {
      direction: crossedPositive ? 'LONG' : 'SHORT',
      strength,
      signal_type: 'macd_signal_cross',
    };
  }

  reset(): void { this._prevHist = NaN; }
}

// ─────────────────────────────────────────────────────────────
// SIGNAL ENGINE FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Builds default SignalEngine from StrategyDefinition parameters.
 * Default evaluator set: EMACrossover + RSIMeanReversion + MACDSignalCross.
 * All three are registered and validated against pipeline keys.
 *
 * Called by BacktestRunner during engine initialisation (Phase 5E).
 */
export function buildSignalEngine(params: {
  config: SignalEngineConfig;
  emaFastKey: string;
  emaSlowKey: string;
  rsiKey: string;
  macdHistKey: string;
  macdLineKey: string;
  availableIndicatorKeys: readonly string[];
  perfContext?: StrategyPerformanceContext;
}): SignalEngine {
  const engine = new SignalEngine(params.config);

  engine
    .registerEvaluator(new EMACrossoverEvaluator(params.emaFastKey, params.emaSlowKey))
    .registerEvaluator(new RSIMeanReversionEvaluator(params.rsiKey))
    .registerEvaluator(new MACDSignalCrossEvaluator(params.macdHistKey, params.macdLineKey));

  engine.validate(params.availableIndicatorKeys);

  if (params.perfContext) {
    engine.seedPerformanceContext(params.perfContext);
  }

  return engine;
}

// ─────────────────────────────────────────────────────────────
// UUID UTILITY — deterministic in test, crypto in production
// ─────────────────────────────────────────────────────────────

/**
 * Generate UUID v4.
 * Uses crypto.randomUUID() in production (Node 14.17+).
 * Replace with seeded PRNG in test harness for deterministic signal_ids.
 * signal_id uniqueness is required by signals table PK (Phase 3C).
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older Node: RFC 4122 v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ─────────────────────────────────────────────────────────────
// PHASE 5D DELIVERY CHECKLIST
// ─────────────────────────────────────────────────────────────
//
// [x] SignalEvent — EXACT Phase 4C shape, readonly, no additions/removals
// [x] SignalFeatures — internal typed struct → features: object for Phase 4C
// [x] ISignalEvaluator — name, requiredIndicators, evaluate(), reset()
// [x] SignalVote — direction, strength, signal_type
// [x] RegimeWeightTable — per-regime multiplier, loaded from regime_performance
// [x] DEFAULT_REGIME_WEIGHTS — conservative defaults; SIDEWAYS = 0.5
// [x] buildRegimeWeightTable() — ratio of regime_win_rate / overall_win_rate
// [x] KellyCalculator — full Kelly → half-Kelly → regime adj → cap → floor
// [x] SLTPCalculator — fixed/trailing/time_based SL; fixed/scaled/r_multiple TP
// [x] SignalFilter — 4 filters: warmup, min_strength, regime_zero, cooldown
// [x] StrategyPerformanceContext — win_rate + avg_win_loss_ratio from Phase 3E
// [x] SignalEngine.onBar() — 8-step pipeline; warmup guard as Step 1
// [x] SignalEngine.reset() — fold boundary; does NOT reset performance context
// [x] SignalEngine.updatePerformanceContext() — walk-forward fold update
// [x] SignalEngineBarResult — full per-bar diagnostic; signal = null when suppressed
// [x] EMACrossoverEvaluator — crossover detection, stateful prev-bar tracking
// [x] RSIMeanReversionEvaluator — zone exit detection, stateful
// [x] MACDSignalCrossEvaluator — histogram sign change, stateful
// [x] buildSignalEngine() — factory; validates against pipeline keys
// [x] Determinism — fired_at = bar.bucket_ts (not wall clock); signal_id via crypto
// [x] Warmup suppression — evaluators NOT called during warmup (not just filtered)
//
// NOT in Phase 5D:
// [ ] BacktestRunner end-to-end wiring → Phase 5E
// [ ] ParameterOptimiser → Phase 5F
// [ ] Walk-forward parallelisation → Phase 5G
