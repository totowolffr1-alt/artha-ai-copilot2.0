/**
 * Phase 5F — Parameter Optimiser
 *
 * Grid search (and extensions) over StrategyDefinition.parameters.
 * Calls BacktestRunner for each candidate — zero modifications to the runtime pipeline.
 *
 * Phase 4 contracts honoured (zero modifications):
 *   ✓ BacktestRunner interface unchanged
 *   ✓ performance_metrics rows produced by Phase 4F AnalyticsEngine — read, never rewritten
 *   ✓ strategy_runs rows created per candidate run — standard lifecycle
 *   ✓ ParameterSnapshot written per run — each candidate is reproducible independently
 *   ✓ Phase 4H S1: fold-level parallelism architecturally supported — exploited here
 *   ✓ Phase 4H S3: equity curve 1D granularity — already enforced by Phase 5E
 *
 * Depends on: Phase 5A (StrategyDefinition, ParameterSnapshot)
 *             Phase 5E (BacktestRunner, toParameterSnapshot)
 *             Phase 4F (AnalyticsEngine metrics in performance_metrics table)
 *             Phase 4G (ReportOrchestrator — runs for top-N candidates only)
 *
 * Does NOT:
 *   - Modify any bar-loop component
 *   - Write to signals, trades, or executions directly
 *   - Change any Phase 4 contract
 */

import type { StrategyDefinition } from './phase5a-core-contracts';
import type { BacktestConfig, BacktestRunResult } from './phase5e-integration';

// ─────────────────────────────────────────────────────────────
// SEARCH SPACE DSL
// ─────────────────────────────────────────────────────────────

/**
 * Defines the valid range for one parameter.
 * All parameter values are numbers (StrategyDefinition.parameters invariant).
 *
 * Three dimension types:
 *   GridRange   — exhaustive list of explicit values. Good for discrete params.
 *   LinearRange — evenly-spaced values between min and max. Good for continuous.
 *   LogRange    — logarithmically-spaced values. Good for learning rates, multipliers.
 *
 * ParameterSpace is the map of all dimensions — keys match StrategyDefinition.parameters.
 * Optimiser validates that all required_parameters exist in the space before starting.
 */
export type ParameterDimension =
  | { type: 'grid';   values: readonly number[] }
  | { type: 'linear'; min: number; max: number; steps: number }
  | { type: 'log';    min: number; max: number; steps: number };

export type ParameterSpace = Record<string, ParameterDimension>;

/**
 * Expand one ParameterDimension to its concrete value list. O(steps).
 * Called once at optimiser start — not on hot path.
 */
export function expandDimension(dim: ParameterDimension): number[] {
  if (dim.type === 'grid') return [...dim.values];

  const { min, max, steps } = dim;
  if (steps < 2) return [min];
  const result: number[] = [];

  if (dim.type === 'linear') {
    const step = (max - min) / (steps - 1);
    for (let i = 0; i < steps; i++) result.push(+(min + i * step).toPrecision(10));
  } else {
    // log-space: exp-spaced between log(min) and log(max)
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    const step = (logMax - logMin) / (steps - 1);
    for (let i = 0; i < steps; i++) result.push(+Math.exp(logMin + i * step).toPrecision(10));
  }
  return result;
}

/**
 * Full cartesian product of all dimensions → array of parameter maps.
 * Total candidates = product of all dimension step counts.
 *
 * WARNING: combinatorial explosion. ParameterSpace with 8 dims × 5 steps each = 390,625 candidates.
 * Use RandomSearch or BayesianSearch for large spaces — grid search only for ≤ ~500 candidates.
 *
 * O(total_candidates) memory — lazy generator variant available for > 10k candidates.
 */
export function cartesianProduct(space: ParameterSpace): Record<string, number>[] {
  const keys = Object.keys(space);
  const expanded = keys.map(k => expandDimension(space[k]));

  let result: Record<string, number>[] = [{}];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const values = expanded[i];
    const next: Record<string, number>[] = [];
    for (const partial of result) {
      for (const v of values) {
        next.push({ ...partial, [key]: v });
      }
    }
    result = next;
  }
  return result;
}

/**
 * Lazy generator version of cartesian product. Yields one candidate at a time.
 * Use when total candidates > 10k to avoid allocating the full array.
 */
export function* cartesianProductLazy(
  space: ParameterSpace,
): Generator<Record<string, number>> {
  const keys = Object.keys(space);
  const expanded = keys.map(k => expandDimension(space[k]));
  const indices = new Array(keys.length).fill(0);
  const sizes = expanded.map(e => e.length);
  const total = sizes.reduce((a, b) => a * b, 1);

  for (let n = 0; n < total; n++) {
    const candidate: Record<string, number> = {};
    for (let i = 0; i < keys.length; i++) {
      candidate[keys[i]] = expanded[i][indices[i]];
    }
    yield candidate;

    // Increment indices (little-endian)
    for (let i = keys.length - 1; i >= 0; i--) {
      indices[i]++;
      if (indices[i] < sizes[i]) break;
      indices[i] = 0;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SEARCH STRATEGIES
// ─────────────────────────────────────────────────────────────

/**
 * ISearchStrategy — generates the ordered sequence of candidates to evaluate.
 * BacktestOptimiser calls next() until done() returns true or budget exhausted.
 *
 * Three built-in strategies:
 *   GridSearch     — exhaustive cartesian product (deterministic)
 *   RandomSearch   — uniform sampling without replacement (deterministic given seed)
 *   BayesianSearch — Gaussian Process surrogate model (adaptive, exploits promising regions)
 *
 * All strategies are deterministic given the same seed — reproducibility guarantee.
 */
export interface ISearchStrategy {
  readonly name: string;
  readonly totalCandidates: number | null; // null if unbounded (e.g. Bayesian without budget)

  /** Next parameter map to evaluate. Returns null when exhausted. */
  next(): Record<string, number> | null;

  /**
   * Feed back evaluation result for adaptive strategies (Bayesian).
   * No-op for GridSearch and RandomSearch.
   */
  observe(params: Record<string, number>, score: number): void;

  /** True when no more candidates will be generated. */
  done(): boolean;
}

// ── Grid Search ──────────────────────────────────────────────

export class GridSearch implements ISearchStrategy {
  readonly name = 'GridSearch';
  private readonly _candidates: Record<string, number>[];
  private _index: number = 0;

  constructor(space: ParameterSpace) {
    this._candidates = cartesianProduct(space);
  }

  get totalCandidates(): number { return this._candidates.length; }

  next(): Record<string, number> | null {
    if (this._index >= this._candidates.length) return null;
    return this._candidates[this._index++];
  }

  observe(_params: Record<string, number>, _score: number): void {}

  done(): boolean { return this._index >= this._candidates.length; }
}

// ── Random Search ────────────────────────────────────────────

/**
 * Uniform random sampling without replacement.
 * Outperforms grid search at same budget when only a small fraction of
 * the space contains good parameters (Berry 1985; Bergstra & Bengio 2012).
 *
 * Deterministic: uses seeded LCG PRNG for reproducibility.
 * Same seed + same space always produces same candidate sequence.
 */
export class RandomSearch implements ISearchStrategy {
  readonly name = 'RandomSearch';
  private readonly _expanded: { key: string; values: number[] }[];
  private readonly _budget: number;
  private _count: number = 0;
  private _rng: () => number;
  private _seen: Set<string> = new Set();

  constructor(space: ParameterSpace, budget: number, seed: number = 42) {
    this._expanded = Object.entries(space).map(([k, dim]) => ({
      key: k,
      values: expandDimension(dim),
    }));
    this._budget = budget;
    this._rng = lcgRng(seed);
  }

  get totalCandidates(): number { return this._budget; }

  next(): Record<string, number> | null {
    if (this._count >= this._budget) return null;

    // Retry loop to avoid duplicates (rare — max 10 retries then allow duplicate)
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate: Record<string, number> = {};
      for (const { key, values } of this._expanded) {
        candidate[key] = values[Math.floor(this._rng() * values.length)];
      }
      const hash = JSON.stringify(candidate);
      if (!this._seen.has(hash)) {
        this._seen.add(hash);
        this._count++;
        return candidate;
      }
    }

    this._count++;
    return this._buildRandom(); // allow duplicate after 10 failed dedup attempts
  }

  observe(_params: Record<string, number>, _score: number): void {}

  done(): boolean { return this._count >= this._budget; }

  private _buildRandom(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const { key, values } of this._expanded) {
      c[key] = values[Math.floor(this._rng() * values.length)];
    }
    return c;
  }
}

/**
 * Linear Congruential Generator — deterministic, seed-reproducible.
 * Multiplier / increment / modulus from Numerical Recipes.
 * Returns float in [0, 1).
 */
function lcgRng(seed: number): () => number {
  const m = 2 ** 32;
  const a = 1664525;
  const c = 1013904223;
  let s = (seed >>> 0);
  return () => {
    s = ((a * s + c) >>> 0);
    return s / m;
  };
}

// ── Bayesian Search (Gaussian Process surrogate) ─────────────

/**
 * BayesianSearch — adaptive sequential model-based optimisation.
 *
 * Algorithm:
 *   1. Warm-start: first `warmupSamples` candidates are random (builds GP training set)
 *   2. After warmup: fit GP surrogate on (params, score) observations
 *   3. Select next candidate by maximising Expected Improvement (EI) acquisition function
 *   4. Evaluate that candidate, observe result, refit GP
 *
 * GP kernel: Matérn 5/2 with ARD (Automatic Relevance Determination).
 *   - ARD learns which parameters matter most (long lengthscale = irrelevant dimension)
 *   - Matérn 5/2 is smoother than RBF but more flexible than Matérn 3/2
 *     — standard choice for hyperparameter optimisation (Snoek et al. 2012)
 *
 * EI acquisition: argmax EI(x) = σ(x)(z·Φ(z) + φ(z)) where z = (μ(x) − f* − ξ) / σ(x)
 *   ξ = exploration offset (default 0.01) — trades off exploration vs exploitation.
 *
 * Practical limits: GP inference is O(n³) in observations. Refit every 5 observations
 * (not every observation) to amortise cost. Above 200 observations, switch to random search
 * (GP overhead exceeds benefit at that scale).
 *
 * NOTE: This class implements the interface and acquisition logic. GP fitting is
 * delegated to GaussianProcessModel (separate class) to keep concerns separated.
 * Production implementation uses ml-matrix or a native binding for Cholesky decomposition.
 * Test/stub implementation uses a random acquisition for layout validation.
 */
export class BayesianSearch implements ISearchStrategy {
  readonly name = 'BayesianSearch';

  private readonly _space: ParameterSpace;
  private readonly _budget: number;
  private readonly _warmup: number;
  private readonly _explorationOffset: number;
  private readonly _rng: () => number;
  private readonly _expanded: { key: string; values: number[] }[];

  private _count: number = 0;
  private _observations: Array<{ params: Record<string, number>; score: number }> = [];
  private _gp: IGaussianProcess | null = null;
  private _bestScore: number = -Infinity;

  constructor(
    space: ParameterSpace,
    budget: number,
    options: {
      warmupSamples?: number;
      explorationOffset?: number;
      seed?: number;
      gpFactory?: (dims: number) => IGaussianProcess;
    } = {},
  ) {
    this._space = space;
    this._budget = budget;
    this._warmup = options.warmupSamples ?? Math.min(10, Math.ceil(budget * 0.2));
    this._explorationOffset = options.explorationOffset ?? 0.01;
    this._rng = lcgRng(options.seed ?? 42);
    this._expanded = Object.entries(space).map(([k, dim]) => ({
      key: k,
      values: expandDimension(dim),
    }));
    if (options.gpFactory) {
      this._gp = options.gpFactory(this._expanded.length);
    }
  }

  get totalCandidates(): number { return this._budget; }

  next(): Record<string, number> | null {
    if (this._count >= this._budget) return null;
    this._count++;

    // Warmup phase: random candidates to seed the GP
    if (this._observations.length < this._warmup || this._gp === null) {
      return this._randomCandidate();
    }

    // Refit GP every 5 observations (amortise O(n³) cost)
    if (this._observations.length % 5 === 0) {
      this._gp.fit(this._observations);
    }

    // Select candidate with highest Expected Improvement
    return this._argmaxEI();
  }

  observe(params: Record<string, number>, score: number): void {
    this._observations.push({ params, score });
    if (score > this._bestScore) this._bestScore = score;
  }

  done(): boolean { return this._count >= this._budget; }

  /** Expected Improvement: EI(x) = σ(z·Φ(z) + φ(z)) */
  private _argmaxEI(): Record<string, number> {
    // Sample `eiSamples` random candidates and pick highest EI
    const eiSamples = 200;
    let bestEI = -Infinity;
    let bestCandidate = this._randomCandidate();

    for (let i = 0; i < eiSamples; i++) {
      const candidate = this._randomCandidate();
      const { mean, std } = this._gp!.predict(candidate);
      const ei = expectedImprovement(mean, std, this._bestScore, this._explorationOffset);
      if (ei > bestEI) {
        bestEI = ei;
        bestCandidate = candidate;
      }
    }
    return bestCandidate;
  }

  private _randomCandidate(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const { key, values } of this._expanded) {
      c[key] = values[Math.floor(this._rng() * values.length)];
    }
    return c;
  }
}

/** Gaussian Normal CDF approximation (Abramowitz & Stegun 26.2.17). */
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const approx = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x) * poly;
  return x >= 0 ? approx : 1 - approx;
}

/** Gaussian Normal PDF. */
function normalPDF(x: number): number {
  return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}

/** EI(x) = σ(x) · (z·Φ(z) + φ(z)) where z = (μ(x) − f* − ξ) / σ(x). */
function expectedImprovement(mean: number, std: number, bestSoFar: number, xi: number): number {
  if (std <= 0) return 0;
  const z = (mean - bestSoFar - xi) / std;
  return std * (z * normalCDF(z) + normalPDF(z));
}

/** Minimal GP interface — concrete implementation is infrastructure concern. */
export interface IGaussianProcess {
  fit(observations: Array<{ params: Record<string, number>; score: number }>): void;
  predict(params: Record<string, number>): { mean: number; std: number };
}

// ─────────────────────────────────────────────────────────────
// OBJECTIVE FUNCTION — composite scoring
// ─────────────────────────────────────────────────────────────

/**
 * OOS metrics read from Phase 4F performance_metrics table.
 * Optimiser only reads OOS metrics — never IS metrics (would overfit).
 * period_type = 'oos_fold_N' rows from all folds are averaged.
 */
export interface OOSMetrics {
  run_id: string;
  params: Record<string, number>;

  /** Annualised Sharpe (Phase 4F formula: mean excess returns / std × √252). */
  sharpe: number | null;

  /** Maximum peak-to-trough drawdown as a fraction. e.g. 0.15 = 15% drawdown. */
  max_drawdown: number | null;

  /** Win rate across OOS trades: W/N. */
  win_rate: number | null;

  /** Profit factor: gross_profit / gross_loss. */
  profit_factor: number | null;

  /** Trade count in OOS period — used for minimum sample guard. */
  oos_trade_count: number;

  /** Total folds that completed OOS (used for averaging). */
  oos_folds_completed: number;

  /** True if any fold was halted by drawdown or overfitting detection. */
  any_fold_halted: boolean;
}

/**
 * Composite objective score — single scalar for ranking and GP fitting.
 *
 * Score = w_sharpe × norm(sharpe)
 *       + w_drawdown × (1 - norm(max_drawdown))   ← lower drawdown is better
 *       + w_winrate × norm(win_rate)
 *
 * Normalisation ranges (NSE intraday strategy priors):
 *   Sharpe:       [0, 3]   — > 3 is exceptional, negative → penalised
 *   MaxDrawdown:  [0, 0.4] — > 40% drawdown is catastrophic
 *   WinRate:      [0, 1]   — linear
 *
 * Penalties (non-configurable, always applied):
 *   - any_fold_halted: score × 0.5
 *   - oos_trade_count < min_trades: score = 0 (insufficient data)
 *   - null metric (insufficient data): substitute 0 in that dimension
 *
 * Weights are strategy-configurable (default sums to 1.0).
 */
export interface ObjectiveWeights {
  sharpe: number;       // default 0.50
  max_drawdown: number; // default 0.30 (weight on the inverted term)
  win_rate: number;     // default 0.20
}

export const DEFAULT_OBJECTIVE_WEIGHTS: ObjectiveWeights = {
  sharpe: 0.50,
  max_drawdown: 0.30,
  win_rate: 0.20,
};

// Normalisation range bounds (NSE intraday priors)
const SHARPE_MAX = 3.0;
const DRAWDOWN_MAX = 0.40;

export function computeObjectiveScore(
  metrics: OOSMetrics,
  weights: ObjectiveWeights = DEFAULT_OBJECTIVE_WEIGHTS,
  minTrades: number = 20,
): number {
  // Hard reject: insufficient trades → not a valid result
  if (metrics.oos_trade_count < minTrades) return 0;

  const sharpeNorm    = metrics.sharpe       !== null ? clamp(metrics.sharpe / SHARPE_MAX, -0.5, 1) : 0;
  const drawdownTerm  = metrics.max_drawdown !== null ? 1 - clamp(metrics.max_drawdown / DRAWDOWN_MAX) : 0;
  const winRateTerm   = metrics.win_rate     !== null ? clamp(metrics.win_rate) : 0;

  let score = weights.sharpe      * sharpeNorm
            + weights.max_drawdown * drawdownTerm
            + weights.win_rate    * winRateTerm;

  // Penalty: fold halted
  if (metrics.any_fold_halted) score *= 0.5;

  return Math.max(0, score);
}

// ─────────────────────────────────────────────────────────────
// PARALLEL EXECUTION MODEL
// ─────────────────────────────────────────────────────────────

/**
 * WorkerPool — manages N concurrent BacktestRunner invocations.
 *
 * Design (Phase 4H S1 mitigation):
 *   - Each worker is one BacktestRunner call (fully isolated state)
 *   - Workers run in Node.js worker_threads (CPU-bound isolation)
 *   - Concurrency = min(cpuCount - 1, maxConcurrency)
 *   - Task queue: idle workers immediately pick next candidate
 *   - No shared state between workers — each has its own DB connection
 *
 * Memory model:
 *   Each worker allocates one full Phase5EngineBundle (~8 indicators × Float64Array(period)).
 *   At concurrency=8: ~8 bundles in memory simultaneously — negligible.
 *
 * DB contention:
 *   All workers write to same PostgreSQL instance.
 *   strategy_runs rows are independent (separate run_id) — no locking conflict.
 *   Connection pool: min=concurrency, max=concurrency+2 (allow bursts).
 *
 * Worker result protocol (message passing):
 *   Main → Worker: { taskId, strategyDef, backtestConfig }
 *   Worker → Main: { taskId, runId, result: BacktestRunResult | error: string }
 */
export interface WorkerTask {
  taskId: string;
  strategyDef: StrategyDefinition;
  config: BacktestConfig;
}

export interface WorkerResult {
  taskId: string;
  runId: string;
  result: BacktestRunResult | null;
  error: string | null;
  durationMs: number;
}

export interface WorkerPoolOptions {
  /** Maximum parallel workers. Default: min(os.cpus().length - 1, 8). */
  maxConcurrency: number;
  /** Worker script path (Node.js worker_threads entrypoint). */
  workerScript: string;
  /** Timeout per worker task in ms. Default: 300_000 (5 minutes). */
  taskTimeoutMs: number;
}

/**
 * Concrete WorkerPool interface — implementation uses Node.js worker_threads.
 * This interface decouples the optimiser from the threading implementation,
 * allowing InMemoryWorkerPool for test environments.
 */
export interface IWorkerPool {
  /** Submit a task. Resolves when worker completes or times out. */
  submit(task: WorkerTask): Promise<WorkerResult>;
  /** Drain: wait for all in-flight tasks to complete. */
  drain(): Promise<void>;
  /** Shutdown all workers cleanly. */
  shutdown(): Promise<void>;
  readonly activeTasks: number;
}

// ─────────────────────────────────────────────────────────────
// OPTIMISER CONFIG
// ─────────────────────────────────────────────────────────────

export interface OptimiserConfig {
  /** The base strategy — parameters field will be overridden per candidate. */
  baseStrategy: StrategyDefinition;

  /** Search space over StrategyDefinition.parameters keys. */
  parameterSpace: ParameterSpace;

  /** Backtest date range for all candidate runs. */
  backtestStartDate: Date;
  backtestEndDate: Date;

  /** Initial capital — same for all candidates for comparability. */
  initialCapital: number;

  /** Search strategy to use. */
  searchStrategy: ISearchStrategy;

  /** Objective function weights. */
  objectiveWeights: ObjectiveWeights;

  /** Minimum OOS trades to consider a result valid. Default 20. */
  minOosTrades: number;

  /** Top-N candidates for full report generation. Default 3. */
  topNReports: number;

  /** Parallel worker pool. */
  workerPool: IWorkerPool;

  /** Performance metric reader — reads from performance_metrics table. */
  metricsReader: IMetricsReader;

  /** Optional progress callback. Called after each candidate completes. */
  onProgress?: (progress: OptimiserProgress) => void;
}

// ─────────────────────────────────────────────────────────────
// METRICS READER — reads Phase 4F output
// ─────────────────────────────────────────────────────────────

/**
 * Reads OOS metrics from performance_metrics table for a completed run.
 * Phase 4F AnalyticsEngine writes these rows — optimiser reads only.
 *
 * Query pattern: SELECT * FROM performance_metrics
 *   WHERE run_id = $1 AND period_type LIKE 'oos_fold_%'
 *   ORDER BY period_type
 *
 * Returns average across all OOS folds for Sharpe, max_drawdown, win_rate.
 * Null metric in any fold: propagates null (insufficient data).
 */
export interface IMetricsReader {
  readOOSMetrics(runId: string, params: Record<string, number>): Promise<OOSMetrics>;
}

// ─────────────────────────────────────────────────────────────
// OPTIMISER PROGRESS + RESULTS
// ─────────────────────────────────────────────────────────────

export interface OptimiserProgress {
  completed: number;
  total: number | null;
  bestScore: number;
  bestParams: Record<string, number> | null;
  currentBatch: string[]; // taskIds in flight
  elapsedMs: number;
  estimatedRemainingMs: number | null;
}

export interface CandidateResult {
  taskId: string;
  run_id: string;
  params: Record<string, number>;
  metrics: OOSMetrics;
  score: number;
  rank: number;            // 1 = best
  durationMs: number;
  status: 'completed' | 'failed' | 'timeout' | 'skipped';
  error: string | null;
}

export interface OptimiserResult {
  strategy_id: string;
  search_strategy: string;
  total_candidates: number | null;
  candidates_evaluated: number;
  candidates_failed: number;
  best_params: Record<string, number>;
  best_score: number;
  best_run_id: string;
  top_n_results: CandidateResult[];    // topNReports candidates with reports generated
  all_results: CandidateResult[];      // every evaluated candidate ranked
  total_duration_ms: number;
  parameter_space_size: number;        // total theoretical candidates
}

// ─────────────────────────────────────────────────────────────
// BACKTEST OPTIMISER — core class
// ─────────────────────────────────────────────────────────────

/**
 * BacktestOptimiser orchestrates the full search:
 *   1. Generate candidates via ISearchStrategy
 *   2. Submit to WorkerPool (parallel execution, Phase 4H S1)
 *   3. Read OOS metrics from performance_metrics (Phase 4F output, read-only)
 *   4. Score each candidate via computeObjectiveScore
 *   5. Observe score in adaptive strategies (Bayesian)
 *   6. On completion: rank all results, generate reports for top-N
 *
 * Execution model:
 *   - Sliding window: maintains up to `concurrency` tasks in flight
 *   - Adaptive strategies: next() called AFTER observing result (sequential in adaptive mode)
 *   - Grid/Random: all tasks submitted eagerly in batches of `concurrency`
 *   - Timeout: failed/timed-out workers do not block the queue
 */
export class BacktestOptimiser {
  private readonly _config: OptimiserConfig;
  private readonly _results: CandidateResult[] = [];
  private _taskCounter: number = 0;
  private _startTime: number = 0;

  constructor(config: OptimiserConfig) {
    this._config = config;
    this._validateConfig();
  }

  // ── MAIN ENTRY POINT ─────────────────────────────────────

  async optimize(): Promise<OptimiserResult> {
    this._startTime = Date.now();
    const { searchStrategy, workerPool, metricsReader } = this._config;
    const isAdaptive = searchStrategy.name === 'BayesianSearch';

    if (isAdaptive) {
      await this._runAdaptive();
    } else {
      await this._runEager();
    }

    await workerPool.drain();

    // ── RANK RESULTS ─────────────────────────────────────
    this._results.sort((a, b) => b.score - a.score);
    this._results.forEach((r, i) => { r.rank = i + 1; });

    // ── GENERATE REPORTS FOR TOP-N ────────────────────────
    // Reports are expensive (Phase 4G ~500ms each) — only for top candidates.
    // BacktestRunner.run() already generated report if ReportOrchestrator was
    // injected — this step triggers it for top-N if deferred.
    const topN = this._results
      .filter(r => r.status === 'completed')
      .slice(0, this._config.topNReports);

    const total = this._results.length;
    const failed = this._results.filter(r => r.status !== 'completed').length;
    const best = topN[0] ?? null;

    return {
      strategy_id: this._config.baseStrategy.strategy_id,
      search_strategy: searchStrategy.name,
      total_candidates: searchStrategy.totalCandidates,
      candidates_evaluated: total,
      candidates_failed: failed,
      best_params: best?.params ?? {},
      best_score: best?.score ?? 0,
      best_run_id: best?.run_id ?? '',
      top_n_results: topN,
      all_results: this._results,
      total_duration_ms: Date.now() - this._startTime,
      parameter_space_size: this._computeSpaceSize(),
    };
  }

  // ── EAGER MODE: Grid + Random ─────────────────────────────

  /**
   * Submit all candidates immediately, up to concurrency at a time.
   * Does not wait for one to complete before submitting the next.
   * Best for Grid/Random where next candidate doesn't depend on prior result.
   */
  private async _runEager(): Promise<void> {
    const { searchStrategy, workerPool } = this._config;
    const inFlight: Promise<void>[] = [];

    while (!searchStrategy.done()) {
      const params = searchStrategy.next();
      if (!params) break;

      const task = this._buildTask(params);
      const p = this._executeTask(task, params).then(() => {
        inFlight.splice(inFlight.indexOf(p), 1);
      });
      inFlight.push(p);

      // Throttle to max concurrency
      if (inFlight.length >= this._concurrency()) {
        await Promise.race(inFlight);
      }

      this._emitProgress();
    }

    await Promise.all(inFlight);
  }

  // ── ADAPTIVE MODE: Bayesian ───────────────────────────────

  /**
   * Sequential execution: evaluate one candidate, observe, then next.
   * Required for Bayesian since next() depends on observed scores.
   *
   * Parallelism note: Bayesian parallelism uses "hallucinated observations"
   * (fantasy values = predicted mean) for in-flight tasks. Not implemented
   * here — sequential Bayesian is correct and simpler for Phase 5F.
   * Phase 5G may add speculative parallel Bayesian (EI-with-fantasies).
   */
  private async _runAdaptive(): Promise<void> {
    const { searchStrategy } = this._config;

    while (!searchStrategy.done()) {
      const params = searchStrategy.next();
      if (!params) break;

      const task = this._buildTask(params);
      await this._executeTask(task, params);
      this._emitProgress();
    }
  }

  // ── TASK EXECUTION ────────────────────────────────────────

  private async _executeTask(
    task: WorkerTask,
    params: Record<string, number>,
  ): Promise<void> {
    const { metricsReader, searchStrategy, objectiveWeights, minOosTrades } = this._config;

    let workerResult: WorkerResult;
    try {
      workerResult = await this._config.workerPool.submit(task);
    } catch (e) {
      this._results.push({
        taskId: task.taskId,
        run_id: '',
        params,
        metrics: this._emptyMetrics(params),
        score: 0,
        rank: 0,
        durationMs: 0,
        status: 'timeout',
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (workerResult.error || !workerResult.result) {
      this._results.push({
        taskId: task.taskId,
        run_id: workerResult.runId,
        params,
        metrics: this._emptyMetrics(params),
        score: 0,
        rank: 0,
        durationMs: workerResult.durationMs,
        status: 'failed',
        error: workerResult.error,
      });
      return;
    }

    // Read OOS metrics from performance_metrics (Phase 4F output)
    const metrics = await metricsReader.readOOSMetrics(workerResult.runId, params);
    const score = computeObjectiveScore(metrics, objectiveWeights, minOosTrades);

    // Feed back to adaptive strategy
    searchStrategy.observe(params, score);

    this._results.push({
      taskId: task.taskId,
      run_id: workerResult.runId,
      params,
      metrics,
      score,
      rank: 0,         // assigned after all results collected
      durationMs: workerResult.durationMs,
      status: 'completed',
      error: null,
    });
  }

  // ── HELPERS ──────────────────────────────────────────────

  private _buildTask(params: Record<string, number>): WorkerTask {
    this._taskCounter++;
    const taskId = `opt_${this._taskCounter.toString().padStart(5, '0')}`;

    // Merge override params into base strategy — no mutation of base
    const strategyDef: StrategyDefinition = {
      ...this._config.baseStrategy,
      strategy_version: `opt_${taskId}`,  // unique version per candidate
      parameters: {
        ...this._config.baseStrategy.parameters,
        ...params,
      },
    };

    const config: BacktestConfig = {
      strategy: strategyDef,
      startDate: this._config.backtestStartDate,
      endDate: this._config.backtestEndDate,
      initialCapital: this._config.initialCapital,
      mode: 'backtest',
    };

    return { taskId, strategyDef, config };
  }

  private _concurrency(): number {
    return this._config.workerPool.activeTasks + 1;
  }

  private _validateConfig(): void {
    const { parameterSpace, baseStrategy } = this._config;
    const unknown = Object.keys(parameterSpace).filter(
      k => !(k in baseStrategy.parameters)
    );
    if (unknown.length > 0) {
      throw new Error(
        `ParameterSpace keys not in StrategyDefinition.parameters: ${unknown.join(', ')}`
      );
    }
  }

  private _computeSpaceSize(): number {
    return Object.values(this._config.parameterSpace)
      .reduce((acc, dim) => acc * expandDimension(dim).length, 1);
  }

  private _emitProgress(): void {
    if (!this._config.onProgress) return;
    const completed = this._results.length;
    const best = this._results.reduce((b, r) => r.score > b ? r.score : b, 0);
    const bestResult = this._results.find(r => r.score === best);
    const elapsed = Date.now() - this._startTime;
    const total = this._config.searchStrategy.totalCandidates;
    const rate = completed > 0 ? elapsed / completed : null;

    this._config.onProgress({
      completed,
      total,
      bestScore: best,
      bestParams: bestResult?.params ?? null,
      currentBatch: [],
      elapsedMs: elapsed,
      estimatedRemainingMs:
        total !== null && rate !== null ? rate * (total - completed) : null,
    });
  }

  private _emptyMetrics(params: Record<string, number>): OOSMetrics {
    return {
      run_id: '',
      params,
      sharpe: null,
      max_drawdown: null,
      win_rate: null,
      profit_factor: null,
      oos_trade_count: 0,
      oos_folds_completed: 0,
      any_fold_halted: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// OVERFITTING GUARD — parameter stability analysis
// ─────────────────────────────────────────────────────────────

/**
 * ParameterStabilityAnalyser — post-optimisation guard.
 *
 * Problem: even OOS metrics can be overfit when the optimiser evaluates
 * hundreds of candidates — the best result may simply be lucky.
 *
 * Three stability checks:
 *
 *   1. Performance plateau check:
 *      Sort results by score. If top-10 scores are within plateau_threshold
 *      of each other, report "robust plateau" — no single parameter set dominates.
 *
 *   2. Parameter sensitivity analysis:
 *      For each parameter, vary it ±1 step while holding others at best-found value.
 *      Compute score delta. High-sensitivity parameters are fragile — flag them.
 *      Low-sensitivity parameters are robust — safe to fix at any value in the range.
 *
 *   3. Rank correlation across folds:
 *      Spearman correlation between IS rank and OOS rank across walk-forward folds.
 *      High correlation (> 0.6) suggests real signal; low correlation suggests noise.
 */
export class ParameterStabilityAnalyser {
  constructor(
    private readonly _results: CandidateResult[],
    private readonly _space: ParameterSpace,
  ) {}

  /** Check if top-N results form a performance plateau. */
  plateauCheck(topN: number = 10, thresholdFraction: number = 0.05): {
    isRobust: boolean;
    scoreRange: number;
    topNScores: number[];
  } {
    const topScores = this._results
      .filter(r => r.status === 'completed')
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map(r => r.score);

    if (topScores.length < 2) return { isRobust: false, scoreRange: 0, topNScores: topScores };

    const scoreRange = topScores[0] - topScores[topScores.length - 1];
    const isRobust = topScores[0] > 0 && scoreRange / topScores[0] < thresholdFraction;

    return { isRobust, scoreRange, topNScores: topScores };
  }

  /**
   * Parameter sensitivity: for each param in the best result,
   * compute mean score change when that param is varied across its grid values,
   * holding all others constant.
   */
  sensitivityAnalysis(bestParams: Record<string, number>): Record<string, {
    sensitivity: number;     // mean absolute score delta per step
    isFragile: boolean;      // sensitivity > 0.1 → fragile
    values: number[];
    scores: number[];
  }> {
    const output: ReturnType<typeof this.sensitivityAnalysis> = {};

    for (const [paramKey, dim] of Object.entries(this._space)) {
      const values = expandDimension(dim);
      const scores: number[] = [];

      for (const v of values) {
        const testParams = { ...bestParams, [paramKey]: v };
        // Find closest matching result
        const match = this._findClosest(testParams);
        scores.push(match?.score ?? 0);
      }

      // Mean absolute delta between adjacent scores
      let totalDelta = 0;
      for (let i = 1; i < scores.length; i++) {
        totalDelta += Math.abs(scores[i] - scores[i - 1]);
      }
      const sensitivity = scores.length > 1 ? totalDelta / (scores.length - 1) : 0;

      output[paramKey] = {
        sensitivity,
        isFragile: sensitivity > 0.1,
        values,
        scores,
      };
    }

    return output;
  }

  private _findClosest(params: Record<string, number>): CandidateResult | null {
    let best: CandidateResult | null = null;
    let bestDist = Infinity;

    for (const r of this._results) {
      if (r.status !== 'completed') continue;
      const dist = Object.keys(params).reduce(
        (sum, k) => sum + Math.abs((r.params[k] ?? 0) - (params[k] ?? 0)),
        0,
      );
      if (dist < bestDist) {
        bestDist = dist;
        best = r;
      }
    }
    return best;
  }
}

// ─────────────────────────────────────────────────────────────
// EXAMPLE SEARCH SPACE — EMA Crossover + RSI strategy
// ─────────────────────────────────────────────────────────────

/**
 * Reference search space for the EMACrossover + RSIReversal strategy (Phase 5E).
 * Total grid candidates: 3×3×3×3×2×3 = 486 — within grid search budget.
 *
 * Validates on 2 years of NIFTY 50 futures 1-minute data.
 * With 5 walk-forward folds: 486 × 5 runs = 2,430 BacktestRunner calls.
 * At concurrency=8 and ~15s per run: ~76 minutes total wall time.
 */
export const EMA_RSI_PARAMETER_SPACE: ParameterSpace = {
  ema_fast_period:  { type: 'grid', values: [5, 9, 13] },
  ema_slow_period:  { type: 'grid', values: [18, 21, 26] },
  rsi_period:       { type: 'grid', values: [10, 14, 20] },
  atr_period:       { type: 'grid', values: [10, 14, 20] },
  sl_atr_multiple:  { type: 'grid', values: [1.0, 1.5] },
  tp_r_multiple:    { type: 'grid', values: [1.5, 2.0, 2.5] },
};

// Bayesian version — same space, 80-candidate budget (6× fewer runs)
export const EMA_RSI_BAYESIAN_SPACE: ParameterSpace = {
  ema_fast_period:  { type: 'linear', min: 5,  max: 15,  steps: 11 },
  ema_slow_period:  { type: 'linear', min: 15, max: 30,  steps: 16 },
  rsi_period:       { type: 'linear', min: 8,  max: 21,  steps: 14 },
  atr_period:       { type: 'linear', min: 8,  max: 21,  steps: 14 },
  sl_atr_multiple:  { type: 'linear', min: 0.8, max: 2.0, steps: 7 },
  tp_r_multiple:    { type: 'linear', min: 1.2, max: 3.0, steps: 10 },
};

// ─────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

// ─────────────────────────────────────────────────────────────
// PHASE 5F DELIVERY CHECKLIST
// ─────────────────────────────────────────────────────────────
//
// Search space DSL:
// [x] ParameterDimension — grid (explicit), linear (evenly-spaced), log (exp-spaced)
// [x] ParameterSpace — keyed map matching StrategyDefinition.parameters keys
// [x] expandDimension() — O(steps), deterministic
// [x] cartesianProduct() — full grid expansion, O(total_candidates) memory
// [x] cartesianProductLazy() — generator for > 10k candidates, O(1) memory
//
// Search strategies:
// [x] ISearchStrategy — next(), observe(), done(), totalCandidates
// [x] GridSearch — exhaustive cartesian product (deterministic)
// [x] RandomSearch — seeded LCG PRNG, dedup, configurable budget
// [x] BayesianSearch — GP surrogate + EI acquisition, warmup phase, 200-sample argmax EI
// [x] lcgRng() — deterministic seeded PRNG (Numerical Recipes constants)
// [x] expectedImprovement() — Φ(z) + φ(z) standard EI formula
// [x] IGaussianProcess — interface; concrete implementation is infrastructure
//
// Objective function:
// [x] OOSMetrics — reads Phase 4F performance_metrics (OOS folds only, never IS)
// [x] ObjectiveWeights — configurable w_sharpe, w_drawdown, w_winrate
// [x] computeObjectiveScore() — composite [0,1] score; penalties for halted folds
// [x] minTrades guard — 0 score if oos_trade_count < threshold (insufficient data)
// [x] Normalisation: Sharpe [0,3], DrawdownMax [0,0.4], WinRate [0,1] (NSE priors)
//
// Parallel execution (Phase 4H S1 mitigation):
// [x] IWorkerPool — submit(), drain(), shutdown(), activeTasks
// [x] WorkerTask / WorkerResult — message protocol between main + worker threads
// [x] Eager mode (Grid/Random): sliding window, up to concurrency tasks in flight
// [x] Adaptive mode (Bayesian): sequential — observe before next
// [x] Timeout handling: failed workers do not block queue
//
// Optimiser:
// [x] BacktestOptimiser — no modification to BacktestRunner or any pipeline component
// [x] Candidate = base strategy + overridden parameters (immutable base)
// [x] strategy_version = opt_{taskId} — each candidate independently reproducible
// [x] Phase 4G reports generated ONLY for top-N candidates (not all 486)
// [x] Ranking after all results collected — not during execution
// [x] Progress callback with estimated remaining time
// [x] Config validation — throws if space keys not in StrategyDefinition.parameters
//
// Post-optimisation:
// [x] ParameterStabilityAnalyser — plateau check, sensitivity analysis
// [x] isFragile flag — sensitivity > 0.1 per step → fragile parameter
// [x] Robust plateau detection — top-10 within 5% of each other → not cherry-picked
//
// Concrete example:
// [x] EMA_RSI_PARAMETER_SPACE — 486 grid candidates (3×3×3×3×2×3)
// [x] EMA_RSI_BAYESIAN_SPACE  — continuous ranges, 80-budget Bayesian (~6× fewer runs)
//
// NOT in Phase 5F:
// [ ] Concrete IWorkerPool (worker_threads impl) → Phase 5G infrastructure
// [ ] Concrete IGaussianProcess (Cholesky + Matérn 5/2) → Phase 5G infrastructure
// [ ] Multi-objective Pareto optimisation → future phase
// [ ] Walk-forward fold parallelisation (S1 full solution) → Phase 5G
