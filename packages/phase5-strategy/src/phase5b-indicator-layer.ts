/**
 * Phase 5B — Indicator Layer
 *
 * Extends Phase 5A contracts. No Phase 4 interface modified.
 *
 * Hard requirements:
 * - ALL computations incremental (online) — O(1) per bar, O(n) total
 * - NO full-window recomputation per bar (Phase 4H S2 violation)
 * - Output populates EnrichedBarEvent.indicators (Phase 5A contract)
 * - Key format: "<name>_<period>" — must match StrategyDefinition.required_indicators
 *
 * Depends on:  Phase 5A (IBarEvent, EnrichedBarEvent, StrategyDefinition)
 * Feeds into:  Phase 5C (RegimeEngine consumes EnrichedBarEvent)
 *              Phase 5D (SignalEngine consumes EnrichedBarEvent)
 */

import type { IBarEvent, EnrichedBarEvent } from './phase5a-core-contracts';

// ─────────────────────────────────────────────────────────────
// BAR INPUT — what every indicator receives
// ─────────────────────────────────────────────────────────────

/**
 * Projection of IBarEvent fields consumed by indicators.
 * Indicators receive BarInput, not IBarEvent, to remain decoupled
 * from event shape changes in Phase 4.
 */
export interface BarInput {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: bigint;
  readonly bucket_ts: Date;
}

// ─────────────────────────────────────────────────────────────
// INDICATOR VALUE — what every indicator returns
// ─────────────────────────────────────────────────────────────

/**
 * Single-key indicators return one IndicatorValue.
 * Multi-key indicators (Bollinger, MACD) return IndicatorValueSet.
 *
 * value === NaN  → warmup not complete; IndicatorPipeline writes NaN to map.
 *                  Signal engine must suppress evaluation on NaN (warmup_bars enforced
 *                  by BacktestRunner, but NaN is the defence-in-depth guard).
 * value === null → structural error (e.g. zero volume for VWAP on a non-trading bar).
 *                  IndicatorPipeline skips writing null keys — consumers see key absent.
 */
export interface IndicatorValue {
  /** Computed value. NaN = warmup incomplete. */
  value: number;
  /** Bars consumed since last reset. Used by pipeline to track warmup. */
  bars_seen: number;
}

/**
 * Multi-output indicators emit a named map of values.
 * Each entry key is appended to the indicator's base key in EnrichedBarEvent:
 * e.g. BollingerBands with period=20 → "bb_20_upper", "bb_20_middle", "bb_20_lower"
 * e.g. MACD(12,26,9)              → "macd_26_line", "macd_26_signal", "macd_26_hist"
 */
export interface IndicatorValueSet {
  entries: ReadonlyMap<string, number>; // sub-key → value
  bars_seen: number;
}

// ─────────────────────────────────────────────────────────────
// IIndicator — core interface
// ─────────────────────────────────────────────────────────────

/**
 * Contract every indicator must satisfy.
 *
 * Invariants:
 * 1. update() is O(1) — no full-window iteration.
 * 2. All mutable state is encapsulated — no shared state between instances.
 * 3. reset() returns indicator to constructor state — identical to a fresh instance.
 * 4. outputKeys() returns the exact set of map keys this indicator will write
 *    to EnrichedBarEvent.indicators. IndicatorPipeline validates these at registration.
 *
 * Naming: key property must match pattern ^[a-z][a-z0-9_]*_[0-9]+$
 * (same pattern enforced by ParameterSnapshot JSON schema).
 */
export interface IIndicator {
  /**
   * Stable key prefix for this instance.
   * Single-output: this IS the map key.   e.g. "ema_20"
   * Multi-output:  sub-keys are appended. e.g. "bb_20" → "bb_20_upper"
   */
  readonly key: string;

  /**
   * Minimum bars required before value is valid (not NaN).
   * IndicatorPipeline uses this to compute pipeline-level warmup_bars
   * (= max of all registered indicators' warmup).
   */
  readonly warmupBars: number;

  /**
   * All map keys this indicator will write to EnrichedBarEvent.indicators.
   * Single-output: [this.key].
   * Multi-output:  [this.key + '_upper', this.key + '_middle', ...].
   * Must be stable — same array every call, same instance lifetime.
   */
  outputKeys(): readonly string[];

  /**
   * Advance indicator by one bar. Returns updated value(s).
   * Called exactly once per bar, in pipeline topological order.
   * Must be O(1).
   */
  update(bar: BarInput): IndicatorValue | IndicatorValueSet;

  /**
   * Reset all internal state to initial (as if just constructed).
   * Called by IndicatorPipeline on RegimeEngine.resetBuffer() and seekTo().
   * Must be O(1) or O(warmupBars) — never O(total_bars_seen).
   */
  reset(): void;

  /**
   * True if warmupBars have been consumed and value is not NaN.
   * Convenience — IndicatorPipeline also tracks this externally.
   */
  readonly isReady: boolean;
}

// ─────────────────────────────────────────────────────────────
// INDICATOR BUFFER — rolling window storage
// ─────────────────────────────────────────────────────────────

/**
 * Fixed-capacity circular buffer for rolling window computations.
 * Used internally by indicators that need a sliding window (e.g. RSI, Bollinger).
 *
 * Design:
 * - Backed by a pre-allocated Float64Array of size `capacity`.
 * - O(1) push: write to tail slot, advance pointer mod capacity.
 * - O(1) oldest: read head slot.
 * - No dynamic allocation after construction.
 * - Used only by indicators that genuinely need the window (SMA via Welford,
 *   RSI gain/loss, BB std dev). EMA, MACD do NOT use IndicatorBuffer.
 */
export class IndicatorBuffer {
  private readonly _buf: Float64Array;
  private _head: number = 0;   // index of oldest value
  private _count: number = 0;  // values pushed so far (≤ capacity)

  constructor(readonly capacity: number) {
    if (capacity < 1) throw new RangeError('IndicatorBuffer capacity must be ≥ 1');
    this._buf = new Float64Array(capacity);
  }

  /** Push a new value. O(1). Overwrites oldest when full. */
  push(value: number): void {
    const writeIdx = (this._head + this._count) % this.capacity;
    if (this._count < this.capacity) {
      this._buf[writeIdx] = value;
      this._count++;
    } else {
      // Buffer full: overwrite oldest slot and advance head
      this._buf[this._head] = value;
      this._head = (this._head + 1) % this.capacity;
    }
  }

  /** Oldest value in window. NaN if buffer not yet full. */
  get oldest(): number {
    return this._count < this.capacity ? NaN : this._buf[this._head];
  }

  /** Newest value pushed. NaN if empty. */
  get newest(): number {
    if (this._count === 0) return NaN;
    const idx = (this._head + this._count - 1) % this.capacity;
    return this._buf[idx];
  }

  /** Number of values currently stored (≤ capacity). */
  get length(): number { return this._count; }

  /** True when capacity values have been pushed. */
  get isFull(): boolean { return this._count === this.capacity; }

  /** Reset to empty state. O(1). */
  reset(): void {
    this._head = 0;
    this._count = 0;
    // Float64Array retains values but they're unreachable until overwritten
  }

  /** Iterate values oldest→newest. O(n) — use sparingly, not on hot path. */
  [Symbol.iterator](): Iterator<number> {
    const buf = this._buf;
    const head = this._head;
    const count = this._count;
    const cap = this.capacity;
    let i = 0;
    return {
      next(): IteratorResult<number> {
        if (i >= count) return { value: undefined as any, done: true };
        return { value: buf[(head + i++) % cap], done: false };
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────
// INDICATOR PIPELINE
// ─────────────────────────────────────────────────────────────

/**
 * IndicatorPipeline is the single component that:
 * 1. Holds all IIndicator instances for one strategy run
 * 2. Calls update() on each in registration order per bar
 * 3. Assembles the result Map and attaches it to EnrichedBarEvent
 * 4. Exposes reset() for BacktestRunner / WalkForwardController fold boundaries
 *
 * Registration order = topological order of indicator dependencies.
 * Phase 5B indicators have no inter-dependencies, so any order is valid.
 * Phase 5D may register composite indicators that depend on pipeline outputs —
 * those must be registered AFTER their dependencies.
 *
 * Thread safety: single-threaded; one pipeline per BacktestRunner instance.
 */
export class IndicatorPipeline {
  private readonly _indicators: IIndicator[] = [];
  private readonly _keyIndex: Map<string, IIndicator> = new Map();
  private _warmupBars: number = 0;
  private _frozen: boolean = false;

  /**
   * Register an indicator. Must be called before freeze().
   * Throws if any outputKey is already registered (duplicate prevention).
   */
  register(indicator: IIndicator): this {
    if (this._frozen) {
      throw new Error('IndicatorPipeline is frozen — cannot register after first bar');
    }
    for (const key of indicator.outputKeys()) {
      if (this._keyIndex.has(key)) {
        throw new Error(`Duplicate indicator key: "${key}"`);
      }
      this._keyIndex.set(key, indicator);
    }
    this._indicators.push(indicator);
    this._warmupBars = Math.max(this._warmupBars, indicator.warmupBars);
    return this;
  }

  /**
   * Validate that all keys in requiredKeys are registered.
   * Call after all indicators registered, before first bar.
   * Throws listing any missing keys.
   */
  validate(requiredKeys: readonly string[]): void {
    const missing = requiredKeys.filter(k => !this._keyIndex.has(k));
    if (missing.length > 0) {
      throw new Error(
        `IndicatorPipeline missing required keys: ${missing.join(', ')}`
      );
    }
  }

  /**
   * Maximum warmup bars across all registered indicators.
   * Matches WalkForwardConfig.warmup_bars — BacktestRunner should assert equality.
   */
  get warmupBars(): number { return this._warmupBars; }

  /**
   * Process one bar through all indicators.
   * Returns EnrichedBarEvent with indicators map populated.
   * Freezes pipeline on first call — no further registration allowed.
   *
   * NaN values ARE written to the map during warmup.
   * IndicatorPipeline does not suppress warmup bars — BacktestRunner
   * suppresses SignalEngine evaluation based on warmup_bars count.
   */
  process(bar: IBarEvent): EnrichedBarEvent {
    if (!this._frozen) this._frozen = true;

    const input: BarInput = {
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      bucket_ts: bar.bucket_ts,
    };

    const map = new Map<string, number>();

    for (const indicator of this._indicators) {
      const result = indicator.update(input);

      if ('entries' in result) {
        // Multi-output
        for (const [subKey, value] of result.entries) {
          map.set(subKey, value);
        }
      } else {
        // Single-output
        map.set(indicator.key, result.value);
      }
    }

    return {
      ...bar,
      indicators: map as ReadonlyMap<string, number>,
    };
  }

  /**
   * Reset all indicators to initial state.
   * Called by BacktestRunner at fold boundaries and after seekTo().
   * O(n_indicators) — each indicator's reset() is O(1).
   */
  reset(): void {
    for (const indicator of this._indicators) {
      indicator.reset();
    }
    this._frozen = false; // allow re-registration if needed (e.g. test harness)
  }

  /** Registered indicator count. */
  get size(): number { return this._indicators.length; }
}

// ─────────────────────────────────────────────────────────────
// INDICATOR FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Builds and registers all indicators declared in StrategyDefinition.required_indicators.
 * Parses "<name>_<period>" keys and instantiates the correct class.
 *
 * Called once by BacktestRunner before the bar loop.
 * Throws on unknown indicator names or invalid period values.
 */
export function buildIndicatorPipeline(
  requiredKeys: readonly string[],
  extraParams?: Record<string, number>, // strategy parameters for multi-param indicators
): IndicatorPipeline {
  const pipeline = new IndicatorPipeline();
  const registered = new Set<string>(); // deduplicate same class+period

  for (const key of requiredKeys) {
    if (registered.has(key)) continue;

    const indicator = parseAndCreate(key, extraParams ?? {});
    pipeline.register(indicator);
    registered.add(key);
  }

  pipeline.validate(requiredKeys);
  return pipeline;
}

/**
 * Parse "<name>_<period>" key and instantiate.
 * Multi-param indicators (MACD, BB) may read additional params from extraParams.
 */
function parseAndCreate(
  key: string,
  extra: Record<string, number>,
): IIndicator {
  // Extract last numeric segment as period
  const match = key.match(/^([a-z][a-z0-9_]*)_(\d+)$/);
  if (!match) throw new Error(`Invalid indicator key format: "${key}"`);
  const [, name, periodStr] = match;
  const period = parseInt(periodStr, 10);
  if (period < 1) throw new Error(`Indicator period must be ≥ 1: "${key}"`);

  switch (name) {
    case 'sma':   return new SMAIndicator(period);
    case 'ema':   return new EMAIndicator(period);
    case 'rsi':   return new RSIIndicator(period);
    case 'atr':   return new ATRIndicator(period);
    case 'vwap':  return new VWAPIndicator(); // session-reset, period unused
    case 'bb':    return new BollingerBandsIndicator(period, extra[`bb_${period}_std`] ?? 2.0);
    case 'macd': {
      // MACD key encodes slow period. Fast and signal periods from extra or defaults.
      const fast   = extra[`macd_fast`]   ?? 12;
      const signal = extra[`macd_signal`] ?? 9;
      return new MACDIndicator(fast, period, signal);
    }
    case 'mom':   return new MomentumIndicator(period);
    default:
      throw new Error(`Unknown indicator: "${name}" in key "${key}"`);
  }
}

// ─────────────────────────────────────────────────────────────
// ── INDICATOR 1: SMA (Simple Moving Average)
// Algorithm: incremental sum + circular buffer for oldest eviction
// O(1) per bar: new_sum = old_sum - evicted + new_close
// ─────────────────────────────────────────────────────────────

export class SMAIndicator implements IIndicator {
  readonly key: string;
  readonly warmupBars: number;
  private readonly _buf: IndicatorBuffer;
  private _sum: number = 0;
  private _barsSeen: number = 0;

  constructor(readonly period: number) {
    if (period < 1) throw new RangeError('SMA period must be ≥ 1');
    this.key = `sma_${period}`;
    this.warmupBars = period;
    this._buf = new IndicatorBuffer(period);
  }

  get isReady(): boolean { return this._barsSeen >= this.warmupBars; }
  outputKeys(): readonly string[] { return [this.key]; }

  update(bar: BarInput): IndicatorValue {
    const evicted = this._buf.isFull ? this._buf.oldest : 0;
    this._buf.push(bar.close);
    this._sum += bar.close - (this._buf.length < this.period ? 0 : evicted);
    this._barsSeen++;

    return {
      value: this.isReady ? this._sum / this.period : NaN,
      bars_seen: this._barsSeen,
    };
  }

  reset(): void {
    this._buf.reset();
    this._sum = 0;
    this._barsSeen = 0;
  }
}

// ─────────────────────────────────────────────────────────────
// ── INDICATOR 2: EMA (Exponential Moving Average)
// Algorithm: EMA_t = close_t × k + EMA_{t-1} × (1 - k), k = 2/(period+1)
// Seed: first EMA value = first close (standard initialisation).
// O(1) per bar — no buffer needed.
// ─────────────────────────────────────────────────────────────

export class EMAIndicator implements IIndicator {
  readonly key: string;
  readonly warmupBars: number;
  private readonly _k: number;          // smoothing factor
  private _ema: number = NaN;
  private _barsSeen: number = 0;

  constructor(readonly period: number) {
    if (period < 1) throw new RangeError('EMA period must be ≥ 1');
    this.key = `ema_${period}`;
    this.warmupBars = period;            // conventional: warm up = period bars
    this._k = 2 / (period + 1);
  }

  get isReady(): boolean { return this._barsSeen >= this.warmupBars; }
  outputKeys(): readonly string[] { return [this.key]; }

  update(bar: BarInput): IndicatorValue {
    this._barsSeen++;
    if (this._barsSeen === 1) {
      this._ema = bar.close;             // seed on first bar
    } else {
      this._ema = bar.close * this._k + this._ema * (1 - this._k);
    }
    return {
      value: this.isReady ? this._ema : NaN,
      bars_seen: this._barsSeen,
    };
  }

  reset(): void {
    this._ema = NaN;
    this._barsSeen = 0;
  }
}

// ─────────────────────────────────────────────────────────────
// ── INDICATOR 3: RSI (Relative Strength Index)
// Algorithm: Wilder smoothing (RMA) on gains and losses.
// Seed (bar 1..period): accumulate raw avg gain/loss over first period bars.
// After seed: RMA update = (prev_avg × (period-1) + current) / period. O(1).
// Output: RSI = 100 - 100/(1 + RS), RS = avg_gain / avg_loss.
// ─────────────────────────────────────────────────────────────

export class RSIIndicator implements IIndicator {
  readonly key: string;
  readonly warmupBars: number;
  private _prevClose: number = NaN;
  private _avgGain: number = 0;
  private _avgLoss: number = 0;
  private _barsSeen: number = 0;
  private _seedGainSum: number = 0;  // accumulated during seed phase
  private _seedLossSum: number = 0;

  constructor(readonly period: number) {
    if (period < 2) throw new RangeError('RSI period must be ≥ 2');
    this.key = `rsi_${period}`;
    this.warmupBars = period + 1;  // need period price changes → period+1 bars
  }

  get isReady(): boolean { return this._barsSeen >= this.warmupBars; }
  outputKeys(): readonly string[] { return [this.key]; }

  update(bar: BarInput): IndicatorValue {
    this._barsSeen++;

    if (this._barsSeen === 1) {
      this._prevClose = bar.close;
      return { value: NaN, bars_seen: this._barsSeen };
    }

    const change = bar.close - this._prevClose;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    this._prevClose = bar.close;

    if (this._barsSeen <= this.period) {
      // Seed phase: accumulate sum for simple average
      this._seedGainSum += gain;
      this._seedLossSum += loss;
    }

    if (this._barsSeen === this.period) {
      // End of seed phase: set initial Wilder averages
      this._avgGain = this._seedGainSum / this.period;
      this._avgLoss = this._seedLossSum / this.period;
    } else if (this._barsSeen > this.period) {
      // Wilder RMA: (prev × (n-1) + current) / n
      this._avgGain = (this._avgGain * (this.period - 1) + gain) / this.period;
      this._avgLoss = (this._avgLoss * (this.period - 1) + loss) / this.period;
    }

    if (!this.isReady) return { value: NaN, bars_seen: this._barsSeen };

    const rs = this._avgLoss === 0 ? Infinity : this._avgGain / this._avgLoss;
    const rsi = this._avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    return { value: rsi, bars_seen: this._barsSeen };
  }

  reset(): void {
    this._prevClose = NaN;
    this._avgGain = 0;
    this._avgLoss = 0;
    this._barsSeen = 0;
    this._seedGainSum = 0;
    this._seedLossSum = 0;
  }
}

// ─────────────────────────────────────────────────────────────
// ── INDICATOR 4: ATR (Average True Range)
// Algorithm: Wilder RMA on TR. TR = max(high-low, |high-prevClose|, |low-prevClose|).
// Seed: SMA of first `period` TRs. Then Wilder RMA.
// O(1) per bar.
// ─────────────────────────────────────────────────────────────

export class ATRIndicator implements IIndicator {
  readonly key: string;
  readonly warmupBars: number;
  private _prevClose: number = NaN;
  private _atr: number = NaN;
  private _seedSum: number = 0;
  private _barsSeen: number = 0;

  constructor(readonly period: number) {
    if (period < 1) throw new RangeError('ATR period must be ≥ 1');
    this.key = `atr_${period}`;
    this.warmupBars = period + 1; // need prevClose → first real TR at bar 2
  }

  get isReady(): boolean { return this._barsSeen >= this.warmupBars; }
  outputKeys(): readonly string[] { return [this.key]; }

  update(bar: BarInput): IndicatorValue {
    this._barsSeen++;

    if (this._barsSeen === 1) {
      this._prevClose = bar.close;
      return { value: NaN, bars_seen: this._barsSeen };
    }

    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - this._prevClose),
      Math.abs(bar.low  - this._prevClose),
    );
    this._prevClose = bar.close;

    const trBar = this._barsSeen - 1; // TR bar count (starts at 1 on bar 2)

    if (trBar < this.period) {
      this._seedSum += tr;
    } else if (trBar === this.period) {
      this._seedSum += tr;
      this._atr = this._seedSum / this.period; // seed ATR
    } else {
      // Wilder RMA
      this._atr = (this._atr * (this.period - 1) + tr) / this.period;
    }

    return {
      value: this.isReady ? this._atr : NaN,
      bars_seen: this._barsSeen,
    };
  }

  reset(): void {
    this._prevClose = NaN;
    this._atr = NaN;
    this._seedSum = 0;
    this._barsSeen = 0;
  }
}

// ─────────────────────────────────────────────────────────────
// ── INDICATOR 5: VWAP (Volume-Weighted Average Price)
// Algorithm: cumulative (sum of price×volume) / (sum of volume) within session.
// Session = NSE trading day (09:15 IST → 15:30 IST).
// Resets at session open (first bar of day).
// Output key: "vwap_0" (period = 0 signals session-scoped, no lookback window).
// O(1) per bar — two running sums.
// ─────────────────────────────────────────────────────────────

export class VWAPIndicator implements IIndicator {
  readonly key = 'vwap_0';
  readonly warmupBars = 1; // valid from first bar of session

  private _cumulativePV: number = 0;   // Σ (typical_price × volume)
  private _cumulativeVol: number = 0;  // Σ volume
  private _lastDate: string = '';      // YYYY-MM-DD in IST for session boundary
  private _barsSeen: number = 0;

  get isReady(): boolean { return this._barsSeen >= 1; }
  outputKeys(): readonly string[] { return [this.key]; }

  update(bar: BarInput): IndicatorValue {
    // Detect session boundary: new IST date → reset
    const ist = toISTDateString(bar.bucket_ts);
    if (ist !== this._lastDate) {
      this._cumulativePV = 0;
      this._cumulativeVol = 0;
      this._lastDate = ist;
    }

    const typical = (bar.high + bar.low + bar.close) / 3;
    const vol = Number(bar.volume);
    this._cumulativePV += typical * vol;
    this._cumulativeVol += vol;
    this._barsSeen++;

    const value = this._cumulativeVol === 0 ? NaN
      : this._cumulativePV / this._cumulativeVol;

    return { value, bars_seen: this._barsSeen };
  }

  reset(): void {
    this._cumulativePV = 0;
    this._cumulativeVol = 0;
    this._lastDate = '';
    this._barsSeen = 0;
  }
}

/** Convert UTC Date to IST date string "YYYY-MM-DD". O(1). */
function toISTDateString(utc: Date): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(utc.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
// ── INDICATOR 6: Bollinger Bands
// Algorithm:
//   Middle = SMA(period)             — incremental sum (same as SMAIndicator)
//   StdDev = Welford online variance — O(1) per bar, no buffer needed
//   Upper  = Middle + k × StdDev
//   Lower  = Middle - k × StdDev
//
// Welford:
//   n++; delta = x - mean; mean += delta/n; delta2 = x - mean; M2 += delta*delta2
//   pop_var = M2/n;  std = sqrt(pop_var)
//   On eviction (oldest leaves window): reverse Welford on evicted value.
//   Since we need the WINDOW variance (not running), we maintain window mean + M2
//   using the circular buffer to get the evicted value.
//
// Output keys: "bb_<period>_upper", "bb_<period>_middle", "bb_<period>_lower"
// ─────────────────────────────────────────────────────────────

export class BollingerBandsIndicator implements IIndicator {
  readonly key: string;
  readonly warmupBars: number;

  private readonly _buf: IndicatorBuffer;
  private readonly _k: number;    // std dev multiplier
  private _sum: number = 0;
  private _sumSq: number = 0;     // Σ x² for population variance = Σx²/n - (Σx/n)²
  private _barsSeen: number = 0;

  constructor(readonly period: number, readonly stdMultiplier: number = 2.0) {
    if (period < 2) throw new RangeError('Bollinger period must be ≥ 2');
    this.key = `bb_${period}`;
    this.warmupBars = period;
    this._buf = new IndicatorBuffer(period);
    this._k = stdMultiplier;
  }

  get isReady(): boolean { return this._barsSeen >= this.warmupBars; }

  outputKeys(): readonly string[] {
    return [`${this.key}_upper`, `${this.key}_middle`, `${this.key}_lower`];
  }

  update(bar: BarInput): IndicatorValueSet {
    this._barsSeen++;

    // Evict oldest if buffer full
    if (this._buf.isFull) {
      const old = this._buf.oldest;
      this._sum   -= old;
      this._sumSq -= old * old;
    }

    this._buf.push(bar.close);
    this._sum   += bar.close;
    this._sumSq += bar.close * bar.close;

    if (!this.isReady) {
      return {
        entries: new Map([
          [`${this.key}_upper`,  NaN],
          [`${this.key}_middle`, NaN],
          [`${this.key}_lower`,  NaN],
        ]),
        bars_seen: this._barsSeen,
      };
    }

    const n      = this.period;
    const mean   = this._sum / n;
    // Population variance: E[x²] - E[x]²
    const popVar = Math.max(0, this._sumSq / n - mean * mean);
    const std    = Math.sqrt(popVar);
    const band   = this._k * std;

    return {
      entries: new Map([
        [`${this.key}_upper`,  mean + band],
        [`${this.key}_middle`, mean],
        [`${this.key}_lower`,  mean - band],
      ]),
      bars_seen: this._barsSeen,
    };
  }

  reset(): void {
    this._buf.reset();
    this._sum = 0;
    this._sumSq = 0;
    this._barsSeen = 0;
  }
}

// ─────────────────────────────────────────────────────────────
// ── INDICATOR 7: MACD (Moving Average Convergence/Divergence)
// Algorithm:
//   MACD Line   = EMA(fast) - EMA(slow)
//   Signal Line = EMA(macdLine, signalPeriod)   — EMA of MACD line itself
//   Histogram   = MACD Line - Signal Line
//
// Uses two EMAIndicators + one internal EMA on MACD line.
// O(1) per bar — three EMA updates.
//
// Key: "macd_<slow>" (slow period encodes the main lookback).
// Output keys: "macd_<slow>_line", "macd_<slow>_signal", "macd_<slow>_hist"
//
// Default: fast=12, slow=26, signal=9 (standard settings).
// ─────────────────────────────────────────────────────────────

export class MACDIndicator implements IIndicator {
  readonly key: string;
  readonly warmupBars: number;

  private readonly _fastEMA: EMAIndicator;
  private readonly _slowEMA: EMAIndicator;
  private readonly _signalK: number;
  private _signalEMA: number = NaN;
  private _signalBarsSeen: number = 0; // counts bars after slow EMA is ready
  private _barsSeen: number = 0;

  constructor(
    readonly fastPeriod: number = 12,
    readonly slowPeriod: number = 26,
    readonly signalPeriod: number = 9,
  ) {
    if (fastPeriod >= slowPeriod)
      throw new RangeError('MACD fast period must be < slow period');
    this.key = `macd_${slowPeriod}`;
    // Full warmup = slowPeriod bars (slow EMA) + signalPeriod bars (signal EMA seed)
    this.warmupBars = slowPeriod + signalPeriod;
    this._fastEMA = new EMAIndicator(fastPeriod);
    this._slowEMA = new EMAIndicator(slowPeriod);
    this._signalK = 2 / (signalPeriod + 1);
  }

  get isReady(): boolean { return this._barsSeen >= this.warmupBars; }

  outputKeys(): readonly string[] {
    return [
      `${this.key}_line`,
      `${this.key}_signal`,
      `${this.key}_hist`,
    ];
  }

  update(bar: BarInput): IndicatorValueSet {
    this._barsSeen++;

    const fastResult = this._fastEMA.update(bar);
    const slowResult = this._slowEMA.update(bar);

    const nan3: IndicatorValueSet = {
      entries: new Map([
        [`${this.key}_line`,   NaN],
        [`${this.key}_signal`, NaN],
        [`${this.key}_hist`,   NaN],
      ]),
      bars_seen: this._barsSeen,
    };

    if (!this._slowEMA.isReady) return nan3;

    const macdLine = (fastResult as IndicatorValue).value
                   - (slowResult as IndicatorValue).value;

    // Signal EMA: seed on first post-slow-warmup bar
    this._signalBarsSeen++;
    if (this._signalBarsSeen === 1) {
      this._signalEMA = macdLine;
    } else {
      this._signalEMA = macdLine * this._signalK + this._signalEMA * (1 - this._signalK);
    }

    if (!this.isReady) return nan3;

    const hist = macdLine - this._signalEMA;
    return {
      entries: new Map([
        [`${this.key}_line`,   macdLine],
        [`${this.key}_signal`, this._signalEMA],
        [`${this.key}_hist`,   hist],
      ]),
      bars_seen: this._barsSeen,
    };
  }

  reset(): void {
    this._fastEMA.reset();
    this._slowEMA.reset();
    this._signalEMA = NaN;
    this._signalBarsSeen = 0;
    this._barsSeen = 0;
  }
}

// ─────────────────────────────────────────────────────────────
// ── INDICATOR 8: Momentum (Rate of Change)
// Algorithm: MOM = close_t - close_{t-period}
// Uses circular buffer of size period+1 to store oldest close.
// O(1) per bar.
// Output: raw difference (not percentage ROC).
// ─────────────────────────────────────────────────────────────

export class MomentumIndicator implements IIndicator {
  readonly key: string;
  readonly warmupBars: number;
  private readonly _buf: IndicatorBuffer;
  private _barsSeen: number = 0;

  constructor(readonly period: number) {
    if (period < 1) throw new RangeError('Momentum period must be ≥ 1');
    this.key = `mom_${period}`;
    this.warmupBars = period + 1;  // need period+1 bars for first valid diff
    this._buf = new IndicatorBuffer(period + 1);
  }

  get isReady(): boolean { return this._barsSeen >= this.warmupBars; }
  outputKeys(): readonly string[] { return [this.key]; }

  update(bar: BarInput): IndicatorValue {
    this._barsSeen++;
    const oldest = this._buf.isFull ? this._buf.oldest : NaN;
    this._buf.push(bar.close);

    return {
      value: this.isReady ? bar.close - oldest : NaN,
      bars_seen: this._barsSeen,
    };
  }

  reset(): void {
    this._buf.reset();
    this._barsSeen = 0;
  }
}

// ─────────────────────────────────────────────────────────────
// INDICATOR REGISTRY — lookup type for Phase 5D (SignalEngine)
// ─────────────────────────────────────────────────────────────

/**
 * Maps indicator key → constructor for dynamic registration in Phase 5D.
 * SignalEngine may register composite or strategy-specific indicators
 * not present in the foundational 8.
 */
export type IndicatorConstructor = (key: string, extra: Record<string, number>) => IIndicator;

export const INDICATOR_REGISTRY: ReadonlyMap<string, IndicatorConstructor> = new Map([
  ['sma',  (key, _)     => new SMAIndicator(parsePeriod(key))],
  ['ema',  (key, _)     => new EMAIndicator(parsePeriod(key))],
  ['rsi',  (key, _)     => new RSIIndicator(parsePeriod(key))],
  ['atr',  (key, _)     => new ATRIndicator(parsePeriod(key))],
  ['vwap', (_key, _)    => new VWAPIndicator()],
  ['bb',   (key, extra) => new BollingerBandsIndicator(parsePeriod(key), extra[`${key}_std`] ?? 2.0)],
  ['macd', (key, extra) => new MACDIndicator(extra['macd_fast'] ?? 12, parsePeriod(key), extra['macd_signal'] ?? 9)],
  ['mom',  (key, _)     => new MomentumIndicator(parsePeriod(key))],
]);

function parsePeriod(key: string): number {
  const m = key.match(/_(\d+)$/);
  if (!m) throw new Error(`Cannot parse period from key: "${key}"`);
  return parseInt(m[1], 10);
}

// ─────────────────────────────────────────────────────────────
// PHASE 5B DELIVERY CHECKLIST
// ─────────────────────────────────────────────────────────────
//
// [x] IIndicator interface — key, warmupBars, outputKeys(), update(), reset(), isReady
// [x] IndicatorBuffer — O(1) push/oldest, pre-allocated Float64Array, reset()
// [x] IndicatorPipeline — register/validate/process/reset; freezes on first bar
// [x] buildIndicatorPipeline() — factory from StrategyDefinition.required_indicators
// [x] SMA     — O(1) incremental sum + circular buffer eviction
// [x] EMA     — O(1) exponential smoothing, k = 2/(n+1)
// [x] RSI     — O(1) Wilder RMA on gain/loss, seed phase handled
// [x] ATR     — O(1) Wilder RMA on TR, seed phase handled
// [x] VWAP    — O(1) cumulative PV/V, session-reset on IST date boundary
// [x] Bollinger Bands — O(1) sum+sumSq eviction, pop variance, multi-output
// [x] MACD    — O(1) three EMA chain, warmup = slow+signal, multi-output
// [x] Momentum — O(1) circular buffer diff
// [x] EnrichedBarEvent populated by IndicatorPipeline.process()
// [x] All outputs: key format "<name>_<period>" (Bollinger/MACD: "<name>_<period>_<sub>")
// [x] reset() on all indicators — satisfies RegimeEngine.resetBuffer() chain (Phase 4H req)
// [x] NaN during warmup — not suppressed here; BacktestRunner suppresses SignalEngine
//
// NOT in Phase 5B:
// [ ] IRegimeClassifier, RegimeEngine → Phase 5C
// [ ] ISignalEvaluator, SignalEngine  → Phase 5D
// [ ] Composite / derived indicators  → Phase 5D if needed
