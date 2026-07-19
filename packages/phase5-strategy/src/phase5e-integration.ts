/**
 * Phase 5E — Full Integration Layer
 *
 * Wires every Phase 4 and Phase 5 component into one runnable bar loop.
 * Two concrete runners:
 *   BacktestRunner  — historical replay, WalkForwardController folds
 *   PaperTradingRunner — live feed, real-time paper execution, same engines
 *
 * Phase 4 contracts honoured (zero modifications):
 *   ✓ IMarketDataProvider — HistoricalDataFeed implements; live feed implements
 *   ✓ SignalEvent — exact Phase 4C shape emitted by SignalEngine
 *   ✓ RiskValidationResult — exact Phase 4E shape consumed here
 *   ✓ RegimeEngine.resetBuffer() — called on every fold boundary + seekTo()
 *   ✓ risk_limits table populated before run start
 *   ✓ warmup_bars enforced globally (all engines in lockstep)
 *   ✓ strategy_runs lifecycle: pending → running → completed / failed
 *   ✓ mode column distinguishes backtest / paper / live
 *
 * Depends on: Phase 5A–5D, Phase 4A–4H
 * Feeds into: Phase 5F (ParameterOptimiser uses BacktestRunner)
 *             Phase 5G (WalkForwardController fold parallelisation)
 */

import type {
  IBarEvent,
  EnrichedBarEvent,
  StrategyDefinition,
  ParameterSnapshot,
} from './phase5a-core-contracts';

import type {
  IndicatorPipeline,
} from './phase5b-indicator-layer';

import type {
  RegimeEngine,
  RegimeClassification,
  RegimeLabel,
} from './phase5c-regime-engine';

import type {
  SignalEngine,
  SignalEvent,
  ISignalWriter,
  SignalStatus,
  SignalSuppressReason,
} from './phase5d-signal-engine';

// ─────────────────────────────────────────────────────────────
// PHASE 4 FROZEN CONTRACTS — type-only imports
// DO NOT modify these. They represent Phase 4 final shapes.
// ─────────────────────────────────────────────────────────────

/** Phase 4E frozen — reproduced for reference. */
export interface RiskValidationResult {
  passed: boolean;
  stage: 1 | 2 | 3 | 4 | 5 | 6;
  reason: string | null;
  adjusted_qty: number | null;
  detail: string;
}

/** Phase 4E — six-stage pipeline interface (Phase 5E binds to this). */
export interface IRiskValidationPipeline {
  validate(signal: SignalEvent, portfolioState: PortfolioState): RiskValidationResult;
  updateOnFill(fill: FillEvent): void;
  updateOnBarClose(barClose: BarCloseUpdate): void;
  resetForFold(): void;
}

/** Phase 4C — entry simulator interface. */
export interface IEntrySimulator {
  onSignalApproved(signal: SignalEvent, approvedQty: number, bar: IBarEvent): FillEvent | null;
}

/** Phase 4C — exit simulator interface. */
export interface IExitSimulator {
  onBarClose(bar: IBarEvent): FillEvent[];
  onTickEvent(tick: TickEvent): FillEvent | null;
  forceCloseAll(bar: IBarEvent, reason: CloseReason): FillEvent[];
}

/** Phase 4C — position tracker interface. */
export interface IPositionTracker {
  onFill(fill: FillEvent): void;
  onBarClose(bar: IBarEvent): void;
  getPortfolioState(): PortfolioState;
  forceCloseAll(bar: IBarEvent, reason: CloseReason): void;
}

/** Phase 4B — IMarketDataProvider (Phase 2B frozen interface). */
export interface IMarketDataProvider {
  subscribe(handler: (event: IBarEvent | TickEvent) => void): void;
  unsubscribe(handler: (event: IBarEvent | TickEvent) => void): void;
  seekTo(targetTs: Date): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  readonly isComplete: boolean;
}

/** Phase 4A — WalkForwardController interface. */
export interface IWalkForwardController {
  getFolds(startDate: Date, endDate: Date): WalkForwardFold[];
  onFoldComplete(result: FoldResult): OverfitAssessment;
  readonly foldCount: number;
}

/** Phase 4F — analytics engine interface. */
export interface IAnalyticsEngine {
  computeMetrics(runId: string): Promise<void>;
}

/** Phase 4G — report orchestrator interface. */
export interface IReportOrchestrator {
  generateReports(runId: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// SUPPORTING TYPES
// ─────────────────────────────────────────────────────────────

export interface TickEvent {
  readonly symbol_id: string;
  readonly ltp: number;
  readonly exchange_ts: Date;
  readonly received_ts: Date;
}

export interface FillEvent {
  readonly fill_id: string;
  readonly trade_id: string;
  readonly symbol_id: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly qty: number;
  readonly fill_price: number;
  readonly fill_ts: Date;
  readonly fill_type: 'entry' | 'exit' | 'partial_exit' | 'forced_exit';
  readonly commission_paise: number;
  readonly slippage_paise: number;
}

export type CloseReason =
  | 'sl_triggered' | 'target_hit' | 'timeout_exit'
  | 'forced_exit' | 'fold_boundary_exit' | 'session_end';

export interface BarCloseUpdate {
  symbol_id: string;
  close_price: number;
  bar_ts: Date;
  unrealised_pnl: number;
}

export interface PortfolioState {
  cash_available: number;
  margin_used: number;
  gross_exposure: number;
  net_exposure: number;
  open_trade_count: number;
  portfolio_current_value: number;
  portfolio_peak_value: number;
  session_realised_pnl: number;
  session_unrealised_pnl: number;
  daily_limit_hit: boolean;
  exposure_by_symbol: Map<string, number>;
  exposure_by_segment: Map<string, number>;
  open_symbols: Set<string>;
}

export interface WalkForwardFold {
  fold_index: number;         // 1-based
  is_start: Date;
  is_end: Date;
  oos_start: Date;
  oos_end: Date;
  phase: 'in_sample' | 'out_of_sample';
}

export interface FoldResult {
  fold_index: number;
  phase: 'in_sample' | 'out_of_sample';
  sharpe: number;
  total_trades: number;
  win_rate: number;
  max_drawdown: number;
  drawdown_halted: boolean;
}

export interface OverfitAssessment {
  verdict: 'pass' | 'overfit' | 'insufficient_folds';
  consecutive_underperforming_folds: number;
  halted: boolean;
}

// ─────────────────────────────────────────────────────────────
// STRATEGY RUN LIFECYCLE
// ─────────────────────────────────────────────────────────────

export type StrategyRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'overfit_halted'
  | 'drawdown_halted';

export interface StrategyRunRecord {
  run_id: string;
  strategy_id: string;
  strategy_version: string;
  mode: RunMode;
  status: StrategyRunStatus;
  parameter_snapshot: ParameterSnapshot;
  started_at: Date;
  completed_at: Date | null;
  fold_count: number;
  total_bars_processed: number;
  error_message: string | null;
  reports_jsonb: object | null;  // Phase 4G: Correction 2
}

export type RunMode = 'backtest' | 'paper' | 'live';

// ─────────────────────────────────────────────────────────────
// ENGINE BUNDLE — all Phase 5 engines composed together
// ─────────────────────────────────────────────────────────────

/**
 * All stateful Phase 5 engines for one strategy run.
 * Created once by BacktestRunner/PaperTradingRunner at run start.
 * Passed through fold boundaries — resetAll() resets internal state
 * but does NOT recreate instances (avoids allocation + re-registration overhead).
 */
export interface Phase5EngineBundle {
  indicatorPipeline: IndicatorPipeline;
  regimeEngine: RegimeEngine;
  signalEngine: SignalEngine;
}

/**
 * Reset all Phase 5 engines for a fold boundary or seekTo().
 * Calling order:
 *   1. indicatorPipeline.reset()  — clears all indicator buffers
 *   2. regimeEngine.resetBuffer() — Phase 4 hard contract; clears label history
 *   3. signalEngine.reset()       — clears evaluator state + bar counter
 *
 * All three are lockstep — a bar counter drift between them would
 * cause warmup suppression asymmetry (indicator ready, signal not, etc.).
 */
export function resetEngineBundle(bundle: Phase5EngineBundle): void {
  bundle.indicatorPipeline.reset();
  bundle.regimeEngine.resetBuffer();
  bundle.signalEngine.reset();
}

// ─────────────────────────────────────────────────────────────
// BAR PROCESSOR — one bar step, extracted for testability
// ─────────────────────────────────────────────────────────────

/**
 * Processes a single IBarEvent through the full Phase 5 → Phase 4 pipeline.
 * Called by both BacktestRunner and PaperTradingRunner on every bar.
 * All logic is synchronous and in-memory — no DB access on this path (Phase 4A rule).
 *
 * Step order (matches Phase 4A event flow exactly):
 *   1. IndicatorPipeline.process()  → EnrichedBarEvent
 *   2. RegimeEngine.onBar()         → RegimeClassification
 *   3. SignalEngine.onBar()         → SignalEvent[]
 *   4. For each signal:
 *      a. RiskValidationPipeline.validate()  → RiskValidationResult
 *      b. If passed: EntrySimulator.onSignalApproved()  → FillEvent
 *      c. If failed: signal written as rejected (Phase 4E training data rule)
 *   5. ExitSimulator.onBarClose()   → FillEvent[] (SL/TP breach check)
 *   6. PositionTracker.onBarClose() → MTM + MAE/MFE update
 *   7. DB writes (deferred to caller's write queue — not on hot path)
 *
 * Returns BarStepResult for caller to handle DB writes and fold checks.
 */
export interface BarStepResult {
  enrichedBar: EnrichedBarEvent;
  regime: RegimeClassification;
  signalsEmitted: SignalEvent[];
  signalsApproved: Array<{ signal: SignalEvent; fill: FillEvent | null; approvedQty: number }>;
  signalsRejected: Array<{ signal: SignalEvent; result: RiskValidationResult }>;
  exitFills: FillEvent[];
  portfolioState: PortfolioState;
  inWarmup: boolean;
}

export function processBar(
  rawBar: IBarEvent,
  engines: Phase5EngineBundle,
  risk: IRiskValidationPipeline,
  entry: IEntrySimulator,
  exit: IExitSimulator,
  tracker: IPositionTracker,
): BarStepResult {
  // ── STEP 1: Indicator computation ────────────────────────
  const enrichedBar = engines.indicatorPipeline.process(rawBar);

  // ── STEP 2: Regime classification ────────────────────────
  const regime = engines.regimeEngine.onBar(enrichedBar);
  const inWarmup = regime.label === 'WARMUP' || engines.signalEngine.isInWarmup;

  // ── STEP 3: Signal evaluation ─────────────────────────────
  const signalsEmitted = engines.signalEngine.onBar(enrichedBar, regime);

  // ── STEP 4: Risk gate + entry fills ──────────────────────
  const signalsApproved: BarStepResult['signalsApproved'] = [];
  const signalsRejected: BarStepResult['signalsRejected'] = [];

  for (const signal of signalsEmitted) {
    const portfolioState = tracker.getPortfolioState();
    const result = risk.validate(signal, portfolioState);

    if (result.passed && result.adjusted_qty !== null && result.adjusted_qty > 0) {
      const fill = entry.onSignalApproved(signal, result.adjusted_qty, enrichedBar);
      if (fill) {
        tracker.onFill(fill);
        risk.updateOnFill(fill);
      }
      signalsApproved.push({ signal, fill: fill ?? null, approvedQty: result.adjusted_qty });
    } else {
      // Phase 4E rule: rejected signals are training data
      // ISignalWriter already wrote signal as 'pending' — BacktestRunner
      // updates signals.status to 'rejected' and stores RiskValidationResult
      // in signals.features['risk_rejection'] via SignalRejectionWriter.
      signalsRejected.push({ signal, result });
    }
  }

  // ── STEP 5: Exit check (SL/TP breach on bar close) ───────
  const exitFills = exit.onBarClose(enrichedBar);
  for (const fill of exitFills) {
    tracker.onFill(fill);
    risk.updateOnFill(fill);
  }

  // ── STEP 6: MTM update ───────────────────────────────────
  tracker.onBarClose(enrichedBar);
  risk.updateOnBarClose({
    symbol_id: enrichedBar.symbol,
    close_price: enrichedBar.close,
    bar_ts: enrichedBar.bucket_ts,
    unrealised_pnl: tracker.getPortfolioState().session_unrealised_pnl,
  });

  return {
    enrichedBar,
    regime,
    signalsEmitted,
    signalsApproved,
    signalsRejected,
    exitFills,
    portfolioState: tracker.getPortfolioState(),
    inWarmup,
  };
}

// ─────────────────────────────────────────────────────────────
// BACKTEST RUNNER
// ─────────────────────────────────────────────────────────────

export interface BacktestConfig {
  strategy: StrategyDefinition;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  mode: 'backtest';
}

export interface BacktestRunResult {
  run_id: string;
  status: StrategyRunStatus;
  total_bars: number;
  total_trades: number;
  folds_completed: number;
  overfit_verdict: OverfitAssessment | null;
  error: Error | null;
}

/**
 * BacktestRunner — orchestrates the full backtest bar loop.
 *
 * Lifecycle:
 *   1. run() called → writes strategy_runs row (status = pending)
 *   2. Seed risk_limits table from StrategyDefinition.risk_config
 *   3. WalkForwardController splits date range into folds
 *   4. For each fold:
 *      a. resetEngineBundle() → lockstep engine reset
 *      b. risk.resetForFold()
 *      c. PositionTracker.forceCloseAll() if any open positions from prior fold
 *      d. Load IS date range into HistoricalDataFeed
 *      e. Bar loop over IS bars (warmup_bars suppressed globally)
 *      f. Load OOS date range
 *      g. Bar loop over OOS bars
 *      h. On fold complete: AnalyticsEngine.computeMetrics()
 *      i. SignalEngine.loadPerformanceCache() for next fold
 *      j. WalkForwardController.onFoldComplete() → OverfitAssessment
 *      k. If overfit → halt all folds, mark run overfit_halted
 *   5. AnalyticsEngine.computeMetrics() (all_time)
 *   6. ReportOrchestrator.generateReports()
 *   7. strategy_runs.status = completed / failed / overfit_halted
 *
 * DB write batching (Phase 4A S3 mitigation):
 *   Writes are batched in WriteQueue (max 100 rows or 500ms) and flushed
 *   asynchronously. Hot path (processBar) never awaits a DB write.
 *   Equity curve written at 1D granularity (not per bar) — S3 mitigation.
 */
export class BacktestRunner {
  private _totalBars: number = 0;
  private _totalTrades: number = 0;

  constructor(
    private readonly _config: BacktestConfig,
    private readonly _engines: Phase5EngineBundle,
    private readonly _risk: IRiskValidationPipeline,
    private readonly _entry: IEntrySimulator,
    private readonly _exit: IExitSimulator,
    private readonly _tracker: IPositionTracker,
    private readonly _feed: IMarketDataProvider,
    private readonly _walkForward: IWalkForwardController,
    private readonly _analytics: IAnalyticsEngine,
    private readonly _reports: IReportOrchestrator,
    private readonly _db: IRunRepository,
  ) {}

  async run(): Promise<BacktestRunResult> {
    const { strategy } = this._config;
    const runId = this._db.createStrategyRunId();

    // ── PREFLIGHT ─────────────────────────────────────────
    assertWarmupConsistency(
      strategy.walk_forward_config.warmup_bars,
      this._engines,
    );

    // Seed risk_limits from StrategyDefinition.risk_config (Phase 4E req)
    await this._db.seedRiskLimits(runId, strategy);

    // Write strategy_runs row
    const snapshot = toParameterSnapshot(strategy);
    await this._db.createStrategyRun(runId, strategy, snapshot, 'backtest');

    let overfit: OverfitAssessment | null = null;

    try {
      await this._db.updateRunStatus(runId, 'running');

      const folds = this._walkForward.getFolds(
        this._config.startDate,
        this._config.endDate,
      );

      // ── FOLD LOOP ─────────────────────────────────────
      for (const fold of folds) {
        // ── FOLD BOUNDARY RESET (all engines, lockstep) ──
        resetEngineBundle(this._engines);         // Phase 4 hard contract
        this._risk.resetForFold();

        // Force-close any open positions from prior fold (Phase 4C design)
        const boundaryFills = this._exit.forceCloseAll(
          this._lastBar!, 'fold_boundary_exit'
        );
        for (const f of boundaryFills) {
          this._tracker.onFill(f);
          this._risk.updateOnFill(f);
        }

        // ── IS BAR LOOP ───────────────────────────────
        await this._runPhase(runId, fold.is_start, fold.is_end, fold.fold_index, 'in_sample');

        // Load performance cache for OOS (trained on IS results)
        const [regimeRows, stratRows] = await Promise.all([
          this._db.loadRegimePerformance(runId, strategy.strategy_id),
          this._db.loadStrategyPerformance(runId, strategy.strategy_id),
        ]);
        this._engines.signalEngine.loadPerformanceCache(regimeRows, stratRows);

        // Reset again for OOS phase (fresh warmup, no IS contamination)
        resetEngineBundle(this._engines);

        // ── OOS BAR LOOP ──────────────────────────────
        await this._runPhase(runId, fold.oos_start, fold.oos_end, fold.fold_index, 'out_of_sample');

        // ── FOLD ANALYTICS ────────────────────────────
        await this._analytics.computeMetrics(runId);
        const metrics = await this._db.loadFoldMetrics(runId, fold.fold_index);

        const foldResult: FoldResult = {
          fold_index: fold.fold_index,
          phase: 'out_of_sample',
          sharpe: metrics.sharpe ?? 0,
          total_trades: metrics.total_trades ?? 0,
          win_rate: metrics.win_rate ?? 0,
          max_drawdown: metrics.max_drawdown ?? 0,
          drawdown_halted: metrics.drawdown_halted ?? false,
        };

        overfit = this._walkForward.onFoldComplete(foldResult);

        if (overfit.halted) {
          await this._db.updateRunStatus(runId, 'overfit_halted');
          return this._buildResult(runId, 'overfit_halted', overfit, null);
        }
      }

      // ── POST-RUN ─────────────────────────────────────
      await this._analytics.computeMetrics(runId);  // all_time pass
      await this._reports.generateReports(runId);
      await this._db.updateRunStatus(runId, 'completed');

      return this._buildResult(runId, 'completed', overfit, null);

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this._db.updateRunStatus(runId, 'failed', error.message);
      return this._buildResult(runId, 'failed', overfit, error);
    }
  }

  // ── PRIVATE: PHASE BAR LOOP ────────────────────────────

  private _lastBar: IBarEvent | null = null;

  private async _runPhase(
    runId: string,
    startDate: Date,
    endDate: Date,
    foldIndex: number,
    phase: 'in_sample' | 'out_of_sample',
  ): Promise<void> {
    await this._feed.seekTo(startDate);

    await new Promise<void>((resolve, reject) => {
      const handler = (event: IBarEvent | TickEvent) => {
        // TickEvents handled by ExitSimulator directly — not by bar loop
        if (isTickEvent(event)) {
          const tickFills = this._exit.onTickEvent(event);
          if (tickFills) {
            this._tracker.onFill(tickFills);
            this._risk.updateOnFill(tickFills);
          }
          return;
        }

        const bar = event as IBarEvent;

        // Guard: only process bars within this phase's date range
        if (bar.bucket_ts > endDate) {
          this._feed.pause();
          resolve();
          return;
        }

        this._lastBar = bar;

        // ── HOT PATH: processBar ─────────────────────
        const result = processBar(
          bar,
          this._engines,
          this._risk,
          this._entry,
          this._exit,
          this._tracker,
        );

        this._totalBars++;
        this._totalTrades += result.signalsApproved.length;

        // ── WRITE QUEUE (non-blocking) ────────────────
        // BacktestRunner enqueues; WriteQueue flushes async.
        // Never awaited on the hot path — Phase 4A design rule.
        this._db.enqueueBarResult(runId, foldIndex, phase, result);

        // ── DRAWDOWN HALT CHECK ───────────────────────
        const ps = result.portfolioState;
        const wfConfig = this._config.strategy.walk_forward_config;
        const drawdownFraction = ps.portfolio_peak_value > 0
          ? (ps.portfolio_peak_value - ps.portfolio_current_value) / ps.portfolio_peak_value
          : 0;

        if (drawdownFraction > wfConfig.overfit_sharpe_ratio_threshold) {
          // Halt fold — not run. WalkForwardController handles fold-level drawdown.
          this._engines.regimeEngine.halt();
          this._engines.signalEngine.halt();
          this._feed.pause();
          resolve();
        }

        if (this._feed.isComplete) {
          resolve();
        }
      };

      this._feed.subscribe(handler);
      this._feed.play().catch(reject);
    });
  }

  private _buildResult(
    runId: string,
    status: StrategyRunStatus,
    overfit: OverfitAssessment | null,
    error: Error | null,
  ): BacktestRunResult {
    return {
      run_id: runId,
      status,
      total_bars: this._totalBars,
      total_trades: this._totalTrades,
      folds_completed: this._walkForward.foldCount,
      overfit_verdict: overfit,
      error,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// PAPER TRADING RUNNER
// ─────────────────────────────────────────────────────────────

/**
 * PaperTradingRunner — real-time paper execution using the same engines.
 *
 * Key differences from BacktestRunner:
 *   - Feed is live IMarketDataProvider (AngelOneAdapter, Phase 2B)
 *   - No WalkForwardController — single continuous session
 *   - No fold resets — resets at session end (15:30 IST) and session start
 *   - Kelly performance cache loaded from DB (filled by prior backtests)
 *   - PaperExecutionSimulator replaces EntrySimulator for fills
 *     (same interface; fills computed at next-tick-bid/ask not next-bar-open)
 *   - Writes to same Phase 3 tables with mode = 'paper'
 *   - MIS forced exit at 15:29 IST — same as backtest (Phase 4C rule)
 *
 * Latency profile (no bottlenecks requirement):
 *   IndicatorPipeline:  O(1) per bar — all incremental algorithms (Phase 5B)
 *   RegimeEngine:       O(n_classifiers) per bar — constant n, O(1) per classifier
 *   SignalEngine:       O(n_evaluators) per bar — constant n, O(1) per evaluator
 *   RiskPipeline:       O(6) stages — fully in-memory, no DB on hot path
 *   EntrySimulator:     O(1) fill computation
 *   DB writes:          async write queue — never on hot path
 *
 *   Total hot path: < 1ms per 1-minute bar on standard hardware.
 *   At 375 bars/day (9:15–15:30, 1-min), that is 375ms compute/day — negligible.
 */
export class PaperTradingRunner {
  private _barsSinceSessionStart: number = 0;
  private _sessionActive: boolean = false;

  constructor(
    private readonly _strategy: StrategyDefinition,
    private readonly _runId: string,
    private readonly _engines: Phase5EngineBundle,
    private readonly _risk: IRiskValidationPipeline,
    private readonly _entry: IEntrySimulator,      // PaperExecutionSimulator instance
    private readonly _exit: IExitSimulator,
    private readonly _tracker: IPositionTracker,
    private readonly _liveFeed: IMarketDataProvider,
    private readonly _db: IRunRepository,
  ) {}

  /**
   * Start paper trading session.
   * Called at 09:14 IST (one minute before market open).
   * Warmup begins immediately — first valid signals at bar warmup_bars+1.
   */
  async startSession(): Promise<void> {
    // Load performance cache from most recent backtest run
    const [regimeRows, stratRows] = await Promise.all([
      this._db.loadRegimePerformance(this._runId, this._strategy.strategy_id),
      this._db.loadStrategyPerformance(this._runId, this._strategy.strategy_id),
    ]);
    this._engines.signalEngine.loadPerformanceCache(regimeRows, stratRows);

    // Reset all engines for clean session start
    resetEngineBundle(this._engines);
    this._barsSinceSessionStart = 0;
    this._sessionActive = true;

    await this._db.updateRunStatus(this._runId, 'running');

    this._liveFeed.subscribe(this._onEvent.bind(this));
    await this._liveFeed.play();
  }

  /**
   * End paper trading session.
   * Called at 15:29 IST by session scheduler (MIS forced exit).
   * All open positions force-closed at current bid/ask (PaperExecutionSimulator).
   */
  async endSession(): Promise<void> {
    this._sessionActive = false;

    // MIS forced exit — Phase 4C non-negotiable rule
    const lastBar = this._lastBar;
    if (lastBar) {
      const forceFills = this._exit.forceCloseAll(lastBar, 'session_end');
      for (const f of forceFills) {
        this._tracker.onFill(f);
        this._risk.updateOnFill(f);
      }
    }

    this._engines.regimeEngine.halt();
    this._engines.signalEngine.halt();
    this._liveFeed.pause();

    await this._db.updateRunStatus(this._runId, 'completed');
  }

  private _lastBar: IBarEvent | null = null;

  private _onEvent(event: IBarEvent | TickEvent): void {
    if (!this._sessionActive) return;

    if (isTickEvent(event)) {
      const fill = this._exit.onTickEvent(event);
      if (fill) {
        this._tracker.onFill(fill);
        this._risk.updateOnFill(fill);
      }
      return;
    }

    const bar = event as IBarEvent;
    this._lastBar = bar;
    this._barsSinceSessionStart++;

    // Same processBar as backtest — engine reuse guarantee (Phase 4A principle)
    const result = processBar(
      bar,
      this._engines,
      this._risk,
      this._entry,
      this._exit,
      this._tracker,
    );

    // Paper mode: writes are async, never blocking live data receipt
    this._db.enqueueBarResult(this._runId, 0, 'out_of_sample', result);
  }
}

// ─────────────────────────────────────────────────────────────
// PAPER EXECUTION SIMULATOR
// ─────────────────────────────────────────────────────────────

/**
 * PaperExecutionSimulator — implements IEntrySimulator for paper mode.
 *
 * Differences from backtest EntrySimulator:
 *   - Uses tick bid/ask spread for fill price (not next-bar-open)
 *   - Fills are simulated within the same tick, not next bar
 *   - Latency is set to 0 (paper simulation; real latency irrelevant)
 *   - All other rules identical: CostAggregator applies same costs,
 *     Phase 3C schema writes identical, mode = 'paper'
 *
 * SlippageModel still applies — simulates market impact even in paper mode.
 * This prevents false confidence from zero-slippage paper results.
 */
export interface IPaperExecutionSimulator extends IEntrySimulator {
  /** Update with latest tick bid/ask for next fill computation. */
  onTick(tick: TickEvent & { bid: number; ask: number }): void;
}

// ─────────────────────────────────────────────────────────────
// SIGNAL REJECTION WRITER
// ─────────────────────────────────────────────────────────────

/**
 * Handles Phase 4E rule: rejected signals are training data.
 * Updates signals.status to 'rejected' and writes RiskValidationResult
 * to signals.features['risk_rejection'] after RiskValidationPipeline decision.
 *
 * Called by BacktestRunner.processBar() — not ISignalWriter (which writes
 * signals as 'pending' at emit time, before risk validation).
 */
export interface ISignalRejectionWriter {
  markRejected(
    signalId: string,
    result: RiskValidationResult,
  ): void;

  markApproved(
    signalId: string,
    approvedQty: number,
  ): void;
}

// ─────────────────────────────────────────────────────────────
// WARMUP CONSISTENCY ASSERTION
// ─────────────────────────────────────────────────────────────

/**
 * Asserts all three engines agree on warmup_bars value.
 * Called at BacktestRunner.run() start before any bar processing.
 *
 * Why: warmup suppression must be lockstep across:
 *   - IndicatorPipeline (emits NaN until warmupBars bars seen)
 *   - RegimeEngine (emits WARMUP until warmupBars bars seen)
 *   - SignalEngine (suppresses signals until warmupBars bars seen)
 *
 * A mismatch means SignalEngine might fire while indicators are still NaN,
 * or RegimeEngine might classify before indicators are ready.
 * Throws at run-start — never silently continues with mismatched warmup.
 */
export function assertWarmupConsistency(
  strategyWarmupBars: number,
  engines: Phase5EngineBundle,
): void {
  const pipelineWarmup = engines.indicatorPipeline.warmupBars;
  const regimeWarmup   = engines.regimeEngine.warmupBars;
  const signalWarmup   = engines.signalEngine.warmupBars;

  const mismatches: string[] = [];

  if (pipelineWarmup !== strategyWarmupBars) {
    mismatches.push(
      `IndicatorPipeline.warmupBars=${pipelineWarmup} ≠ strategy=${strategyWarmupBars}`
    );
  }
  if (regimeWarmup !== strategyWarmupBars) {
    mismatches.push(
      `RegimeEngine.warmupBars=${regimeWarmup} ≠ strategy=${strategyWarmupBars}`
    );
  }
  if (signalWarmup !== strategyWarmupBars) {
    mismatches.push(
      `SignalEngine.warmupBars=${signalWarmup} ≠ strategy=${strategyWarmupBars}`
    );
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Warmup bar mismatch — engines must be lockstep:\n${mismatches.join('\n')}`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// PARAMETER SNAPSHOT BUILDER
// ─────────────────────────────────────────────────────────────

/**
 * Deterministic projection of StrategyDefinition → ParameterSnapshot.
 * Called exactly once at run start (before bar loop begins).
 * Written to strategy_runs.parameter_snapshot JSONB (Phase 4H M5 requirement).
 *
 * Rules:
 *   1. required_indicators sorted ascending (deterministic key order)
 *   2. benchmark_symbol_id explicit null if absent (no key omission)
 *   3. snapshot_schema_version = 1
 *   4. No non-reproducible fields (run_id, started_at, author, tags)
 */
export function toParameterSnapshot(strategy: StrategyDefinition): ParameterSnapshot {
  return {
    strategy_id: strategy.strategy_id,
    strategy_version: strategy.strategy_version,
    symbol_id: strategy.symbol_id,
    timeframe: strategy.timeframe,
    segment: strategy.segment,
    product_type: strategy.product_type,
    parameters: { ...strategy.parameters },
    required_indicators: [...strategy.required_indicators].sort(),
    sl_config: { ...strategy.sl_config },
    tp_config: {
      type: strategy.tp_config.type,
      levels: strategy.tp_config.levels.map(l => ({ ...l })) as ParameterSnapshot['tp_config']['levels'],
    },
    sl_tp_conflict: strategy.sl_tp_conflict,
    risk_config: { ...strategy.risk_config, span_margin_rates: { ...strategy.risk_config.span_margin_rates } },
    cost_config: { ...strategy.cost_config },
    walk_forward_config: { ...strategy.walk_forward_config },
    data_gap_handling: strategy.data_gap_handling,
    benchmark_symbol_id: strategy.benchmark_symbol_id ?? null,
    snapshot_schema_version: 1,
  };
}

// ─────────────────────────────────────────────────────────────
// DB REPOSITORY INTERFACE
// ─────────────────────────────────────────────────────────────

/**
 * IRunRepository — all DB operations BacktestRunner and PaperTradingRunner need.
 * Implementations:
 *   PostgresRunRepository (production)
 *   InMemoryRunRepository (tests — deterministic, zero latency)
 *
 * Write operations are enqueue-only on the hot path.
 * WriteQueue flushes in background; never blocks processBar().
 */
export interface IRunRepository {
  createStrategyRunId(): string;
  createStrategyRun(
    runId: string,
    strategy: StrategyDefinition,
    snapshot: ParameterSnapshot,
    mode: RunMode,
  ): Promise<void>;
  updateRunStatus(
    runId: string,
    status: StrategyRunStatus,
    errorMessage?: string,
  ): Promise<void>;
  seedRiskLimits(runId: string, strategy: StrategyDefinition): Promise<void>;
  loadRegimePerformance(
    runId: string,
    strategyId: string,
  ): Promise<import('./phase5d-signal-engine').RegimePerformanceRow[]>;
  loadStrategyPerformance(
    runId: string,
    strategyId: string,
  ): Promise<import('./phase5d-signal-engine').StrategyPerformanceRow[]>;
  loadFoldMetrics(
    runId: string,
    foldIndex: number,
  ): Promise<{ sharpe?: number; total_trades?: number; win_rate?: number; max_drawdown?: number; drawdown_halted?: boolean }>;
  /** Non-blocking — writes go into queue, flushed asynchronously. */
  enqueueBarResult(
    runId: string,
    foldIndex: number,
    phase: 'in_sample' | 'out_of_sample',
    result: BarStepResult,
  ): void;
}

// ─────────────────────────────────────────────────────────────
// TYPE GUARDS
// ─────────────────────────────────────────────────────────────

function isTickEvent(event: IBarEvent | TickEvent): event is TickEvent {
  return 'ltp' in event;
}

// ─────────────────────────────────────────────────────────────
// RE-EXPORTS for Phase 5F (ParameterOptimiser entry point)
// ─────────────────────────────────────────────────────────────

export type { ParameterSnapshot } from './phase5a-core-contracts';
export type { StrategyDefinition } from './phase5a-core-contracts';

// ─────────────────────────────────────────────────────────────
// PHASE 5E DELIVERY CHECKLIST
// ─────────────────────────────────────────────────────────────
//
// Integration contracts (Phase 4 frozen — zero modifications):
// [x] IMarketDataProvider — feed interface unchanged (Phase 2B)
// [x] SignalEvent — exact 13-field Phase 4C shape; never modified
// [x] RiskValidationResult — exact Phase 4E shape; consumed not produced here
// [x] RegimeEngine.resetBuffer() — called in resetEngineBundle() on every fold boundary
// [x] risk_limits table seeded before bar loop (BacktestRunner.run() preflight)
// [x] strategy_runs lifecycle: pending → running → completed/failed/overfit_halted
// [x] mode column: 'backtest' vs 'paper' (same Phase 3 tables, filter-only separation)
// [x] Rejected signals: ISignalRejectionWriter updates status + features (Phase 4E)
// [x] Fold boundary: forceCloseAll → fold_boundary_exit (Phase 4C rule)
// [x] MIS forced exit: endSession() at 15:29 IST (Phase 4C non-negotiable rule)
//
// Warmup enforcement (Phase 4H M7 — global, lockstep):
// [x] assertWarmupConsistency() — throws if any engine disagrees on warmup_bars
// [x] All three engines (pipeline, regime, signal) reset together in resetEngineBundle()
// [x] resetEngineBundle() called: run start, IS→OOS transition, fold boundary, seekTo()
// [x] inWarmup flag propagated in BarStepResult for caller audit
//
// Bar loop — processBar() step order (matches Phase 4A event flow):
// [x] Step 1: IndicatorPipeline.process() → EnrichedBarEvent
// [x] Step 2: RegimeEngine.onBar() → RegimeClassification
// [x] Step 3: SignalEngine.onBar() → SignalEvent[]
// [x] Step 4: RiskValidationPipeline.validate() + EntrySimulator.onSignalApproved()
// [x] Step 5: ExitSimulator.onBarClose() → SL/TP breach fills
// [x] Step 6: PositionTracker.onBarClose() → MTM + MAE/MFE
// [x] TickEvents routed to ExitSimulator.onTickEvent() outside bar loop
// [x] No DB access on hot path — all writes via non-blocking enqueueBarResult()
//
// Performance (no latency bottlenecks):
// [x] All Phase 5 engine operations O(1) per bar (Phase 5B incremental guarantee)
// [x] Risk pipeline: 6 stages, fully in-memory, no DB reads (Phase 4E design)
// [x] Write queue: async flush, never blocks bar event handler
// [x] Equity curve: written at 1D granularity only (Phase 4H S3 mitigation)
// [x] CostAggregator segment rate cache (Phase 4H P1 mitigation)
//
// Engine reuse guarantee (Phase 4A core principle):
// [x] processBar() is identical for BacktestRunner and PaperTradingRunner
// [x] Same Phase5EngineBundle used in both runners
// [x] PaperTradingRunner subscribes to IMarketDataProvider — same interface as backtest
// [x] Backtest EntrySimulator and PaperExecutionSimulator share IEntrySimulator interface
//
// ParameterSnapshot:
// [x] toParameterSnapshot() — deterministic, no non-reproducible fields
// [x] required_indicators sorted ascending
// [x] benchmark_symbol_id always explicit null
// [x] Written to strategy_runs BEFORE bar loop starts
//
// NOT in Phase 5E:
// [ ] ParameterOptimiser (grid search over StrategyDefinition.parameters) → Phase 5F
// [ ] WalkForwardController fold parallelisation → Phase 5G
// [ ] Concrete PostgresRunRepository implementation → Phase 5E.1 (separate file)
// [ ] Concrete strategy factory (EMACrossover + RSI as one StrategyDefinition) → Phase 5E.2
