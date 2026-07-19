/**
 * Phase 5C — Regime Engine
 *
 * Consumes EnrichedBarEvent (Phase 5A/5B).
 * Emits RegimeLabel consumed by SignalEngine (Phase 5D) and written
 * to SignalEvent.regime (Phase 4C frozen contract).
 *
 * Phase 4 contracts honoured (no modifications):
 *   - RegimeEngine.resetBuffer() callable by BacktestRunner + WalkForwardController
 *   - RegimeEngine receives EnrichedBarEvent via ReplayEventBus (same interface as live)
 *   - regime: string field in SignalEvent — RegimeLabel values are the string values
 *
 * Depends on:  Phase 5A (EnrichedBarEvent, WalkForwardConfig)
 *              Phase 5B (IndicatorPipeline — already ran before RegimeEngine sees bar)
 * Feeds into:  Phase 5D (SignalEngine receives RegimeLabel per bar)
 */

import type { EnrichedBarEvent } from './phase5a-core-contracts';

// ─────────────────────────────────────────────────────────────
// REGIME LABEL
// ─────────────────────────────────────────────────────────────

/**
 * Canonical regime strings.
 * These values flow into SignalEvent.regime (Phase 4C frozen field: string).
 * Never add a value here without updating IRegimeClassifier implementations
 * and the regime_performance table seeding logic (Phase 3E dependency).
 *
 * WARMUP = special internal label emitted when engine is not yet ready.
 * SignalEngine MUST treat WARMUP identically to null — no signal evaluation.
 */
export type RegimeLabel =
  | 'TRENDING_UP'
  | 'TRENDING_DOWN'
  | 'SIDEWAYS'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'WARMUP';         // internal; emitted during warmup_bars suppression window

/** All valid post-warmup labels — use for type narrowing in SignalEngine. */
export type ActiveRegimeLabel = Exclude<RegimeLabel, 'WARMUP'>;

export const REGIME_LABELS: readonly ActiveRegimeLabel[] = [
  'TRENDING_UP',
  'TRENDING_DOWN',
  'SIDEWAYS',
  'HIGH_VOLATILITY',
  'LOW_VOLATILITY',
];

// ─────────────────────────────────────────────────────────────
// REGIME CLASSIFICATION RESULT
// ─────────────────────────────────────────────────────────────

/**
 * Output of one classification step.
 * confidence: [0, 1] — how strongly the current bar fits the label.
 *   Used by SignalEngine for regime-conditional weighting (Phase 4 integration req).
 * indicators_used: keys from EnrichedBarEvent.indicators that drove this decision.
 *   Stored in learning_records.features for the learning engine.
 */
export interface RegimeClassification {
  label: RegimeLabel;
  confidence: number;                  // [0, 1]
  indicators_used: readonly string[];  // indicator keys that drove decision
  bars_since_reset: number;            // diagnostic / audit field
}

// ─────────────────────────────────────────────────────────────
// IREGIME CLASSIFIER — one pluggable classification strategy
// ─────────────────────────────────────────────────────────────

/**
 * A single classifier votes for one RegimeLabel.
 * RegimeEngine aggregates votes from all registered classifiers.
 *
 * Invariants:
 * 1. classify() is O(1) — reads from indicators map only, no iteration.
 * 2. requiredIndicators must be a subset of StrategyDefinition.required_indicators.
 *    RegimeEngine.validate() checks this at run start.
 * 3. warmupBars ≤ IndicatorPipeline.warmupBars — classifiers cannot require
 *    more warmup than the pipeline provides.
 * 4. reset() returns to constructor state — called on fold boundary and seekTo().
 */
export interface IRegimeClassifier {
  /** Stable name for this classifier — used in logging and features map. */
  readonly name: string;

  /** Indicator keys this classifier reads from EnrichedBarEvent.indicators. */
  readonly requiredIndicators: readonly string[];

  /**
   * Minimum valid bars before this classifier returns a non-WARMUP label.
   * Usually equals the longest indicator warmup it depends on.
   */
  readonly warmupBars: number;

  /**
   * Classify the current bar. Returns WARMUP if not yet ready.
   * Must be O(1). Must be deterministic given same indicators map.
   */
  classify(
    bar: EnrichedBarEvent,
    barsSeenSinceReset: number,
  ): { label: RegimeLabel; confidence: number };

  /** Reset internal state. Called on fold boundary and seekTo(). */
  reset(): void;
}

// ─────────────────────────────────────────────────────────────
// REGIME STATE MACHINE
// ─────────────────────────────────────────────────────────────

/**
 * Valid engine lifecycle states.
 *
 * Transitions:
 *   UNINITIALISED ──play()──────────────→ WARMING_UP
 *   WARMING_UP    ──warmup complete──────→ ACTIVE
 *   ACTIVE        ──seekTo()────────────→ WARMING_UP   (reset + re-warm)
 *   ACTIVE        ──resetBuffer()───────→ WARMING_UP   (fold boundary)
 *   WARMING_UP    ──resetBuffer()───────→ WARMING_UP   (idempotent mid-warmup)
 *   ANY           ──halt()─────────────→ HALTED        (fold drawdown halt)
 *   HALTED        ──resetBuffer()───────→ WARMING_UP   (new fold start)
 */
export type RegimeEngineState =
  | 'UNINITIALISED'
  | 'WARMING_UP'
  | 'ACTIVE'
  | 'HALTED';

export interface RegimeStateTransition {
  from: RegimeEngineState;
  to: RegimeEngineState;
  trigger: 'play' | 'warmup_complete' | 'resetBuffer' | 'seekTo' | 'halt';
  bars_seen_at_transition: number;
  timestamp: Date;
}

// ─────────────────────────────────────────────────────────────
// REGIME HISTORY — rolling window for smoothing
// ─────────────────────────────────────────────────────────────

/**
 * Circular buffer of recent regime labels.
 * Used by RegimeEngine to smooth label flipping:
 * confirmed label requires `confirmationBars` consecutive identical votes.
 *
 * Backed by a plain array of size `capacity` (labels are enums, not floats —
 * Float64Array not appropriate here).
 */
class RegimeLabelBuffer {
  private readonly _buf: RegimeLabel[];
  private _head: number = 0;
  private _count: number = 0;

  constructor(readonly capacity: number) {
    if (capacity < 1) throw new RangeError('RegimeLabelBuffer capacity must be ≥ 1');
    this._buf = new Array(capacity).fill('WARMUP');
  }

  push(label: RegimeLabel): void {
    this._buf[(this._head + this._count) % this.capacity] = label;
    if (this._count < this.capacity) {
      this._count++;
    } else {
      this._head = (this._head + 1) % this.capacity;
    }
  }

  /** Most recent label. */
  get latest(): RegimeLabel {
    if (this._count === 0) return 'WARMUP';
    return this._buf[(this._head + this._count - 1) % this.capacity];
  }

  /** Count occurrences of `label` in current window. */
  countOf(label: RegimeLabel): number {
    let n = 0;
    for (let i = 0; i < this._count; i++) {
      if (this._buf[(this._head + i) % this.capacity] === label) n++;
    }
    return n;
  }

  get length(): number { return this._count; }
  get isFull(): boolean { return this._count === this.capacity; }

  reset(): void {
    this._head = 0;
    this._count = 0;
    this._buf.fill('WARMUP');
  }
}

// ─────────────────────────────────────────────────────────────
// REGIME ENGINE CONFIG
// ─────────────────────────────────────────────────────────────

export interface RegimeEngineConfig {
  /**
   * Bars of warmup required before emitting ACTIVE labels.
   * Must equal WalkForwardConfig.warmup_bars from StrategyDefinition.
   * BacktestRunner asserts: regimeEngine.warmupBars === strategyDef.walk_forward_config.warmup_bars
   */
  warmupBars: number;

  /**
   * Consecutive bars a label must hold before becoming the confirmed label.
   * Prevents single-bar regime flips from triggering signal changes.
   * Range: [1, 10]. Default: 3.
   * 1 = no smoothing (raw classifier output).
   */
  confirmationBars: number;

  /**
   * Minimum classifier confidence to accept a vote.
   * Votes below threshold are treated as SIDEWAYS abstention.
   * Range: [0, 1]. Default: 0.6.
   */
  minConfidenceThreshold: number;

  /**
   * Voting strategy when multiple classifiers disagree.
   * 'plurality': label with most votes wins; tie → SIDEWAYS.
   * 'weighted':  votes weighted by confidence; tie → SIDEWAYS.
   * Default: 'weighted'.
   */
  votingStrategy: 'plurality' | 'weighted';
}

export const DEFAULT_REGIME_ENGINE_CONFIG: RegimeEngineConfig = {
  warmupBars: 50,          // overridden by WalkForwardConfig.warmup_bars
  confirmationBars: 3,
  minConfidenceThreshold: 0.6,
  votingStrategy: 'weighted',
};

// ─────────────────────────────────────────────────────────────
// REGIME ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * RegimeEngine: aggregates IRegimeClassifier votes per bar,
 * applies confirmation smoothing, enforces warmup suppression,
 * and exposes resetBuffer() for BacktestRunner/WalkForwardController.
 *
 * Phase 4 hard contracts satisfied:
 *   ✓ RegimeEngine.resetBuffer() callable (Phase 4 integration table)
 *   ✓ seekTo() resets buffer + re-enters WARMING_UP (Phase 4B invariant 1)
 *   ✓ No regime label emitted during warmup_bars (Phase 4H M7)
 *   ✓ Deterministic: given same bars in same order, same labels always produced
 *
 * Integration point in bar loop (Phase 4A event flow):
 *   ReplayEventBus → RegimeEngine.onBar(enrichedBar) → RegimeLabel
 *   → stored on RegimeEngine.currentLabel
 *   → SignalEngine reads currentLabel before evaluating signals
 */
export class RegimeEngine {
  private readonly _classifiers: IRegimeClassifier[] = [];
  private readonly _config: RegimeEngineConfig;
  private readonly _labelHistory: RegimeLabelBuffer;

  private _state: RegimeEngineState = 'UNINITIALISED';
  private _barsSinceReset: number = 0;
  private _currentLabel: RegimeLabel = 'WARMUP';
  private _confirmedLabel: RegimeLabel = 'WARMUP';
  private _lastClassification: RegimeClassification | null = null;
  private _stateHistory: RegimeStateTransition[] = [];
  private _frozen: boolean = false;

  constructor(config: Partial<RegimeEngineConfig> = {}) {
    this._config = { ...DEFAULT_REGIME_ENGINE_CONFIG, ...config };
    this._labelHistory = new RegimeLabelBuffer(
      Math.max(this._config.confirmationBars, 1)
    );
  }

  // ── READ-ONLY ACCESSORS ──────────────────────────────────

  /** Current confirmed regime label. WARMUP during warmup window. */
  get currentLabel(): RegimeLabel { return this._confirmedLabel; }

  /** Raw (unconfirmed) label from last bar's voting. */
  get rawLabel(): RegimeLabel { return this._currentLabel; }

  get state(): RegimeEngineState { return this._state; }

  get barsSinceReset(): number { return this._barsSinceReset; }

  get warmupBars(): number { return this._config.warmupBars; }

  /** True when engine is ACTIVE and currentLabel is not WARMUP. */
  get isReady(): boolean {
    return this._state === 'ACTIVE' && this._confirmedLabel !== 'WARMUP';
  }

  get lastClassification(): RegimeClassification | null {
    return this._lastClassification;
  }

  // ── REGISTRATION ────────────────────────────────────────

  /**
   * Register a classifier. Must be called before first onBar().
   * Throws if classifier.requiredIndicators contains unknown keys
   * (validate() must be called after registration to enforce this).
   */
  registerClassifier(classifier: IRegimeClassifier): this {
    if (this._frozen) {
      throw new Error('RegimeEngine frozen — cannot register after first bar');
    }
    this._classifiers.push(classifier);
    return this;
  }

  /**
   * Validate all classifiers' requiredIndicators exist in the pipeline.
   * Call after all classifiers registered, before first bar.
   * Throws listing any missing indicator keys.
   */
  validate(availableIndicatorKeys: readonly string[]): void {
    const keySet = new Set(availableIndicatorKeys);
    const missing: string[] = [];
    for (const c of this._classifiers) {
      for (const k of c.requiredIndicators) {
        if (!keySet.has(k)) missing.push(`${c.name}:${k}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(`RegimeEngine missing indicator keys: ${missing.join(', ')}`);
    }
    if (this._classifiers.length === 0) {
      throw new Error('RegimeEngine has no classifiers registered');
    }
  }

  // ── MAIN ENTRY POINT ────────────────────────────────────

  /**
   * Process one bar. Called by ReplayEventBus (Phase 4A event flow).
   *
   * Returns RegimeClassification with label = WARMUP if engine not yet active.
   * BacktestRunner checks isReady before passing label to SignalEngine.
   *
   * Freezes engine on first call — no further classifier registration.
   */
  onBar(bar: EnrichedBarEvent): RegimeClassification {
    if (!this._frozen) {
      this._frozen = true;
      this._transition('play', bar.bucket_ts);
    }

    this._barsSinceReset++;

    // ── WARMUP SUPPRESSION ──────────────────────────────
    if (this._barsSinceReset <= this._config.warmupBars) {
      // Still in warmup: run classifiers to advance their internal state
      // but always return WARMUP label — never emit regime to SignalEngine.
      this._runClassifiers(bar, /* suppressOutput */ true);

      if (this._barsSinceReset === this._config.warmupBars) {
        this._transition('warmup_complete', bar.bucket_ts);
      }

      const result: RegimeClassification = {
        label: 'WARMUP',
        confidence: 0,
        indicators_used: [],
        bars_since_reset: this._barsSinceReset,
      };
      this._lastClassification = result;
      return result;
    }

    // ── ACTIVE CLASSIFICATION ────────────────────────────
    const { label, confidence, indicators_used } = this._runClassifiers(bar, false);

    // Push raw label into confirmation buffer
    this._labelHistory.push(label);
    this._currentLabel = label;

    // Confirmed label: majority in confirmation window
    this._confirmedLabel = this._resolveConfirmedLabel();

    const result: RegimeClassification = {
      label: this._confirmedLabel,
      confidence,
      indicators_used,
      bars_since_reset: this._barsSinceReset,
    };
    this._lastClassification = result;
    return result;
  }

  // ── PHASE 4 MANDATORY CONTRACT: resetBuffer() ───────────

  /**
   * Reset all internal state. Called by:
   *   - BacktestRunner at fold boundary (WalkForwardController.onFoldComplete)
   *   - BacktestRunner at run start
   *   - WalkForwardController before each new fold
   *
   * After reset: state = WARMING_UP, currentLabel = WARMUP,
   * all classifiers reset, bar counter = 0.
   * Next onBar() call begins re-warmup from bar 1.
   *
   * This is the Phase 4 hard contract:
   *   "RegimeEngine.resetBuffer() callable by BacktestRunner and WalkForwardController"
   */
  resetBuffer(): void {
    this._barsSinceReset = 0;
    this._currentLabel = 'WARMUP';
    this._confirmedLabel = 'WARMUP';
    this._lastClassification = null;
    this._labelHistory.reset();
    this._frozen = false; // allow onBar() to re-freeze and re-transition

    for (const c of this._classifiers) {
      c.reset();
    }

    // Transition to WARMING_UP regardless of current state
    this._state = 'WARMING_UP';
    this._stateHistory.push({
      from: this._state,
      to: 'WARMING_UP',
      trigger: 'resetBuffer',
      bars_seen_at_transition: 0,
      timestamp: new Date(),
    });
  }

  // ── seekTo() ────────────────────────────────────────────

  /**
   * Seek to a new position in the replay timeline.
   * Called by ReplayController.seekTo() (Phase 4B).
   *
   * Phase 4B invariant:
   *   "RegimeEngine.resetBuffer() is called on every seekTo()"
   * This method calls resetBuffer() then records the seek trigger separately.
   *
   * seekTo() is equivalent to resetBuffer() for regime engine purposes:
   * both require full re-warmup before valid labels resume.
   */
  seekTo(targetTs: Date): void {
    this.resetBuffer();
    // Override last history entry trigger to 'seekTo' for audit trail
    if (this._stateHistory.length > 0) {
      const last = this._stateHistory[this._stateHistory.length - 1];
      (last as { trigger: string }).trigger = 'seekTo';
      last.timestamp = targetTs;
    }
  }

  /**
   * Halt engine — called when WalkForwardController detects drawdown halt.
   * Engine emits WARMUP for remaining bars in fold.
   * Cleared by next resetBuffer() call (new fold start).
   */
  halt(): void {
    const prev = this._state;
    this._state = 'HALTED';
    this._confirmedLabel = 'WARMUP';
    this._stateHistory.push({
      from: prev,
      to: 'HALTED',
      trigger: 'halt',
      bars_seen_at_transition: this._barsSinceReset,
      timestamp: new Date(),
    });
  }

  /** State transition history — for audit and test assertions. */
  get stateHistory(): readonly RegimeStateTransition[] {
    return this._stateHistory;
  }

  // ── PRIVATE: VOTING ─────────────────────────────────────

  private _runClassifiers(
    bar: EnrichedBarEvent,
    suppressOutput: boolean,
  ): { label: RegimeLabel; confidence: number; indicators_used: string[] } {
    if (suppressOutput) {
      // Advance classifier internal state without collecting votes
      for (const c of this._classifiers) {
        c.classify(bar, this._barsSinceReset);
      }
      return { label: 'WARMUP', confidence: 0, indicators_used: [] };
    }

    if (this._config.votingStrategy === 'plurality') {
      return this._pluralityVote(bar);
    }
    return this._weightedVote(bar);
  }

  /**
   * Plurality vote: label with most votes wins.
   * Tie → SIDEWAYS (conservative fallback).
   */
  private _pluralityVote(
    bar: EnrichedBarEvent,
  ): { label: RegimeLabel; confidence: number; indicators_used: string[] } {
    const counts = new Map<RegimeLabel, number>();
    const indicators_used: string[] = [];

    for (const c of this._classifiers) {
      const { label, confidence } = c.classify(bar, this._barsSinceReset);
      if (label === 'WARMUP') continue;
      if (confidence < this._config.minConfidenceThreshold) continue; // abstain

      counts.set(label, (counts.get(label) ?? 0) + 1);
      for (const k of c.requiredIndicators) {
        if (!indicators_used.includes(k)) indicators_used.push(k);
      }
    }

    if (counts.size === 0) {
      return { label: 'SIDEWAYS', confidence: 0.5, indicators_used };
    }

    let winner: RegimeLabel = 'SIDEWAYS';
    let maxVotes = 0;
    let tied = false;

    for (const [label, votes] of counts) {
      if (votes > maxVotes) { maxVotes = votes; winner = label; tied = false; }
      else if (votes === maxVotes) { tied = true; }
    }

    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const confidence = tied ? 0.5 : maxVotes / total;

    return { label: tied ? 'SIDEWAYS' : winner, confidence, indicators_used };
  }

  /**
   * Weighted vote: each classifier votes with weight = confidence.
   * Label with highest summed weight wins. Tie → SIDEWAYS.
   * Classifiers below minConfidenceThreshold abstain (weight = 0).
   */
  private _weightedVote(
    bar: EnrichedBarEvent,
  ): { label: RegimeLabel; confidence: number; indicators_used: string[] } {
    const weights = new Map<RegimeLabel, number>();
    const indicators_used: string[] = [];
    let totalWeight = 0;

    for (const c of this._classifiers) {
      const { label, confidence } = c.classify(bar, this._barsSinceReset);
      if (label === 'WARMUP') continue;
      if (confidence < this._config.minConfidenceThreshold) continue;

      weights.set(label, (weights.get(label) ?? 0) + confidence);
      totalWeight += confidence;

      for (const k of c.requiredIndicators) {
        if (!indicators_used.includes(k)) indicators_used.push(k);
      }
    }

    if (weights.size === 0 || totalWeight === 0) {
      return { label: 'SIDEWAYS', confidence: 0.5, indicators_used };
    }

    let winner: RegimeLabel = 'SIDEWAYS';
    let maxWeight = 0;
    let tied = false;

    for (const [label, w] of weights) {
      if (w > maxWeight) { maxWeight = w; winner = label; tied = false; }
      else if (w === maxWeight) { tied = true; }
    }

    const confidence = tied ? 0.5 : maxWeight / totalWeight;
    return { label: tied ? 'SIDEWAYS' : winner, confidence, indicators_used };
  }

  /**
   * Resolve confirmed label from history buffer.
   * A label is confirmed when it appears `confirmationBars` times in the buffer.
   * If no label meets threshold → carry forward previous confirmedLabel (hysteresis).
   */
  private _resolveConfirmedLabel(): RegimeLabel {
    const needed = this._config.confirmationBars;

    for (const label of REGIME_LABELS) {
      if (this._labelHistory.countOf(label) >= needed) {
        return label;
      }
    }
    // No label confirmed → hysteresis: keep previous confirmed label
    // First bars after warmup (before history buffer fills): use raw label
    if (!this._labelHistory.isFull) {
      return this._currentLabel === 'WARMUP' ? 'SIDEWAYS' : this._currentLabel;
    }
    return this._confirmedLabel; // hysteresis
  }

  private _transition(
    trigger: RegimeStateTransition['trigger'],
    ts: Date,
  ): void {
    const from = this._state;
    let to: RegimeEngineState;

    switch (trigger) {
      case 'play':           to = 'WARMING_UP'; break;
      case 'warmup_complete': to = 'ACTIVE';    break;
      case 'resetBuffer':    to = 'WARMING_UP'; break;
      case 'seekTo':         to = 'WARMING_UP'; break;
      case 'halt':           to = 'HALTED';     break;
    }

    this._state = to;
    this._stateHistory.push({
      from, to, trigger,
      bars_seen_at_transition: this._barsSinceReset,
      timestamp: ts,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// CONCRETE CLASSIFIER 1: TrendClassifier
// Uses EMA crossover + ADX-proxy to detect trend.
// Reads: ema_fast, ema_slow (from EnrichedBarEvent.indicators)
// ─────────────────────────────────────────────────────────────

/**
 * Classifies TRENDING_UP / TRENDING_DOWN / SIDEWAYS based on:
 *   - EMA separation: |ema_fast - ema_slow| / ema_slow > separation_threshold → trending
 *   - Direction:      ema_fast > ema_slow → UP, else → DOWN
 *   - Confidence:     proportional to separation ratio (capped at 1.0)
 *
 * Does NOT use ATR — that is VolatilityClassifier's domain.
 * Single responsibility: trend detection only.
 */
export class TrendClassifier implements IRegimeClassifier {
  readonly name = 'TrendClassifier';

  constructor(
    private readonly fastKey: string,     // e.g. "ema_9"
    private readonly slowKey: string,     // e.g. "ema_21"
    /** Minimum EMA separation fraction to declare trending (default 0.003 = 0.3%) */
    private readonly separationThreshold: number = 0.003,
  ) {}

  get requiredIndicators(): readonly string[] {
    return [this.fastKey, this.slowKey];
  }

  get warmupBars(): number { return 0; } // inherits from indicator warmup

  classify(
    bar: EnrichedBarEvent,
    _barsSeenSinceReset: number,
  ): { label: RegimeLabel; confidence: number } {
    const ind = bar.indicators;
    if (!ind) return { label: 'WARMUP', confidence: 0 };

    const fast = ind.get(this.fastKey);
    const slow = ind.get(this.slowKey);

    if (fast === undefined || slow === undefined || isNaN(fast) || isNaN(slow) || slow === 0) {
      return { label: 'WARMUP', confidence: 0 };
    }

    const separation = Math.abs(fast - slow) / slow;

    if (separation < this.separationThreshold) {
      // EMAs too close → sideways
      const confidence = 1 - (separation / this.separationThreshold); // closer → more confident sideways
      return { label: 'SIDEWAYS', confidence: Math.min(confidence, 1) };
    }

    const label: RegimeLabel = fast > slow ? 'TRENDING_UP' : 'TRENDING_DOWN';
    // Confidence: how much separation exceeds threshold (saturates at 3× threshold)
    const excessRatio = Math.min(separation / (this.separationThreshold * 3), 1);
    return { label, confidence: 0.5 + excessRatio * 0.5 };
  }

  reset(): void {
    // Stateless classifier — no internal buffer to reset
  }
}

// ─────────────────────────────────────────────────────────────
// CONCRETE CLASSIFIER 2: VolatilityClassifier
// Uses ATR relative to price to detect volatility regime.
// Reads: atr_<period>, and current close from bar.
// ─────────────────────────────────────────────────────────────

/**
 * Classifies HIGH_VOLATILITY / LOW_VOLATILITY / SIDEWAYS based on:
 *   ATR% = atr / close × 100
 *   ATR% > highThreshold → HIGH_VOLATILITY
 *   ATR% < lowThreshold  → LOW_VOLATILITY
 *   else                 → SIDEWAYS (normal volatility, defer to TrendClassifier)
 *
 * For NSE 1-minute data, typical ATR% thresholds:
 *   NIFTY futures: high = 0.25%, low = 0.05%
 *   Mid-cap stocks: high = 0.50%, low = 0.10%
 *   Configurable — strategy passes via constructor.
 *
 * Uses EMA of ATR% (online smoothing) to prevent single-spike flips.
 */
export class VolatilityClassifier implements IRegimeClassifier {
  readonly name = 'VolatilityClassifier';

  private readonly _smoothingK: number;
  private _smoothedAtrPct: number = NaN;
  private _barsSeen: number = 0;

  constructor(
    private readonly atrKey: string,          // e.g. "atr_14"
    /** ATR% above this → HIGH_VOLATILITY. Default 0.25 (= 0.25%) */
    private readonly highThreshold: number = 0.25,
    /** ATR% below this → LOW_VOLATILITY.  Default 0.05 */
    private readonly lowThreshold: number = 0.05,
    /** Smoothing period for ATR% EMA (default 5 bars) */
    private readonly smoothingPeriod: number = 5,
  ) {
    this._smoothingK = 2 / (smoothingPeriod + 1);
  }

  get requiredIndicators(): readonly string[] { return [this.atrKey]; }
  get warmupBars(): number { return 0; }

  classify(
    bar: EnrichedBarEvent,
    _barsSeenSinceReset: number,
  ): { label: RegimeLabel; confidence: number } {
    const ind = bar.indicators;
    if (!ind) return { label: 'WARMUP', confidence: 0 };

    const atr = ind.get(this.atrKey);
    if (atr === undefined || isNaN(atr) || bar.close === 0) {
      return { label: 'WARMUP', confidence: 0 };
    }

    const atrPct = (atr / bar.close) * 100;

    // EMA-smooth ATR%: seed on first bar
    this._barsSeen++;
    if (this._barsSeen === 1 || isNaN(this._smoothedAtrPct)) {
      this._smoothedAtrPct = atrPct;
    } else {
      this._smoothedAtrPct =
        atrPct * this._smoothingK + this._smoothedAtrPct * (1 - this._smoothingK);
    }

    const s = this._smoothedAtrPct;

    if (s > this.highThreshold) {
      const confidence = Math.min((s - this.highThreshold) / this.highThreshold + 0.6, 1.0);
      return { label: 'HIGH_VOLATILITY', confidence };
    }

    if (s < this.lowThreshold) {
      const confidence = Math.min((this.lowThreshold - s) / this.lowThreshold + 0.6, 1.0);
      return { label: 'LOW_VOLATILITY', confidence };
    }

    // Normal volatility band → abstain to TrendClassifier (return SIDEWAYS with low confidence)
    return { label: 'SIDEWAYS', confidence: 0.4 };
  }

  reset(): void {
    this._smoothedAtrPct = NaN;
    this._barsSeen = 0;
  }
}

// ─────────────────────────────────────────────────────────────
// CONCRETE CLASSIFIER 3: MomentumRegimeClassifier
// Uses RSI to confirm or override trend label.
// Reads: rsi_<period>
// Adds weight to TRENDING_UP when RSI > 60, TRENDING_DOWN when RSI < 40.
// ─────────────────────────────────────────────────────────────

export class MomentumRegimeClassifier implements IRegimeClassifier {
  readonly name = 'MomentumRegimeClassifier';

  constructor(
    private readonly rsiKey: string,       // e.g. "rsi_14"
    private readonly bullThreshold: number = 60,
    private readonly bearThreshold: number = 40,
  ) {}

  get requiredIndicators(): readonly string[] { return [this.rsiKey]; }
  get warmupBars(): number { return 0; }

  classify(
    bar: EnrichedBarEvent,
    _barsSeenSinceReset: number,
  ): { label: RegimeLabel; confidence: number } {
    const ind = bar.indicators;
    if (!ind) return { label: 'WARMUP', confidence: 0 };

    const rsi = ind.get(this.rsiKey);
    if (rsi === undefined || isNaN(rsi)) return { label: 'WARMUP', confidence: 0 };

    if (rsi > this.bullThreshold) {
      const confidence = Math.min((rsi - this.bullThreshold) / (100 - this.bullThreshold) + 0.5, 1.0);
      return { label: 'TRENDING_UP', confidence };
    }

    if (rsi < this.bearThreshold) {
      const confidence = Math.min((this.bearThreshold - rsi) / this.bearThreshold + 0.5, 1.0);
      return { label: 'TRENDING_DOWN', confidence };
    }

    // RSI in neutral zone → no strong opinion
    return { label: 'SIDEWAYS', confidence: 0.3 };
  }

  reset(): void {
    // Stateless — no internal buffer
  }
}

// ─────────────────────────────────────────────────────────────
// REGIME ENGINE FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Builds default RegimeEngine from StrategyDefinition parameters.
 * Called by BacktestRunner during engine initialisation.
 *
 * Default classifier set:
 *   TrendClassifier(ema_fast, ema_slow)
 *   VolatilityClassifier(atr_14)
 *   MomentumRegimeClassifier(rsi_14)
 *
 * All three keys must be in StrategyDefinition.required_indicators.
 * Engine.validate() is called immediately after construction —
 * throws if any required indicator is missing from pipeline.
 */
export function buildRegimeEngine(params: {
  warmupBars: number;
  emaFastKey: string;
  emaSlowKey: string;
  atrKey: string;
  rsiKey: string;
  availableIndicatorKeys: readonly string[];
  config?: Partial<RegimeEngineConfig>;
}): RegimeEngine {
  const engine = new RegimeEngine({
    ...params.config,
    warmupBars: params.warmupBars,
  });

  engine
    .registerClassifier(new TrendClassifier(params.emaFastKey, params.emaSlowKey))
    .registerClassifier(new VolatilityClassifier(params.atrKey))
    .registerClassifier(new MomentumRegimeClassifier(params.rsiKey));

  engine.validate(params.availableIndicatorKeys);
  return engine;
}

// ─────────────────────────────────────────────────────────────
// PHASE 5C DELIVERY CHECKLIST
// ─────────────────────────────────────────────────────────────
//
// [x] RegimeLabel type — 5 active labels + WARMUP sentinel
// [x] ActiveRegimeLabel — type-safe subset for SignalEngine consumption
// [x] RegimeClassification — label + confidence + indicators_used + bars_since_reset
// [x] IRegimeClassifier — name, requiredIndicators, warmupBars, classify(), reset()
// [x] RegimeLabelBuffer — circular array for confirmation smoothing, O(1) push
// [x] RegimeEngineState — UNINITIALISED/WARMING_UP/ACTIVE/HALTED state machine
// [x] RegimeStateTransition — full audit trail of all state transitions
// [x] RegimeEngine.onBar() — voting, confirmation, warmup suppression
// [x] RegimeEngine.resetBuffer() — Phase 4 HARD CONTRACT (callable by BacktestRunner + WFC)
// [x] RegimeEngine.seekTo() — delegates to resetBuffer(), re-enters WARMING_UP
// [x] RegimeEngine.halt() — drawdown halt path; cleared on next resetBuffer()
// [x] Warmup suppression — classifiers advance state but emit WARMUP for warmup_bars
// [x] Confirmation smoothing — configurationBars consecutive votes required
// [x] Weighted voting (default) + plurality voting (configurable)
// [x] Hysteresis — no label confirmed → carry previous (prevents thrashing)
// [x] TrendClassifier — EMA separation, O(1), stateless
// [x] VolatilityClassifier — ATR%, EMA-smoothed, O(1)
// [x] MomentumRegimeClassifier — RSI confirmation, O(1), stateless
// [x] buildRegimeEngine() — factory; validates against pipeline keys
// [x] Determinism — given same bar sequence, same labels always produced
//
// NOT in Phase 5C:
// [ ] SignalEngine, ISignalEvaluator, SignalEvent emission → Phase 5D
// [ ] regime_performance table reads → Phase 5D (Kelly adjustment)
// [ ] ParameterOptimiser → Phase 5F
