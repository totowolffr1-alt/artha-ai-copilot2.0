# Artha AI — Phase 6: Risk Engine — Complete Design Reference

**Version:** Final (consolidates v3 + ConvictionSizer + PortfolioRisk + SwingRisk + MarketRisk + TradeApproval + Constraints Audit)  
**Status:** DESIGN COMPLETE — Implementation-ready  
**Scope:** Risk evaluation only. No trade execution. No signal generation.  
**Constraint:** All decisions in <50ms. Deterministic. Fully explainable.

---

## 1. Module Breakdown

### 1.1 — Full Directory Tree

```
src/riskEngine/
│
├── index.ts                              ← Barrel. Sole public entry point for Phase 7.
├── types.ts                              ← All Phase 6 domain types
├── errors.ts                             ← RiskEngineError hierarchy
│
├── contracts/                            ← Interfaces only. No implementation.
│   ├── IRiskEngine.ts                    ← Master interface (§3)
│   ├── IRiskValidationPipeline.ts        ← Phase 4E frozen — implemented here
│   ├── IRiskStage.ts                     ← Shared stage interface
│   ├── IRiskMonitor.ts                   ← Read surface for UI + Phase 9
│   ├── ITradeApprovalEngine.ts           ← Phase 7 entry point
│   ├── RiskValidationResult.ts           ← Phase 4E + verdict extension
│   ├── IMarketDataCache.ts               ← Pre-warmed L1/ADV/VIX cache (C3 fix)
│   └── INewsCache.ts                     ← Pre-warmed news assessments (C3 fix)
│
├── approval/                             ← Trade Approval Engine (outermost layer)
│   ├── ITradeApprovalEngine.ts
│   ├── TradeApprovalEngine.ts
│   ├── TradeApprovalResult.ts
│   ├── IConfidenceCalculator.ts
│   └── ConfidenceCalculator.ts
│
├── pipeline/                             ← Composes all stages
│   ├── RiskValidationPipeline.ts
│   └── PipelineContext.ts
│
├── market/                               ← Stage 0 — macro market state
│   ├── IMarketRiskEngine.ts
│   ├── MarketRiskEngine.ts
│   ├── MarketRiskContext.ts
│   ├── indices/
│   │   ├── NiftyTrendAnalyser.ts
│   │   └── BankNiftyTrendAnalyser.ts
│   ├── vix/
│   │   └── VIXAnalyser.ts
│   └── regime/
│       └── MarketRegimeAggregator.ts
│
├── stages/                               ← 5 pipeline stages
│   ├── Stage1_TechnicalValidation.ts     ← Sizer + Exposure + Capital + PortfolioRisk
│   ├── Stage2_VolatilityCheck.ts         ← VolatilityAnalyser + VaR + Drawdown
│   ├── Stage3_MarketRegimeCheck.ts       ← RegimeFilter + NiftyTrendGuard
│   ├── Stage4_LiquidityCheck.ts          ← LiquidityChecker (cache reads only)
│   └── Stage5_SwingRiskCheck.ts          ← EventRisk + MarketStatus + GapRisk + News
│
├── sizer/                                ← Position sizing
│   ├── IPositionSizer.ts
│   ├── PositionSizer.ts                  ← Kelly × ATR × overnight haircut
│   ├── SwingOvernightAdjuster.ts
│   ├── IConvictionScorer.ts
│   ├── ConvictionScorer.ts               ← kelly(0.40) + strength(0.35) + regime_conf(0.25)
│   ├── ConvictionSizer.ts                ← Wraps PositionSizer; applies conviction multiplier
│   └── PositionSizingResult.ts
│
├── exposure/                             ← Per-stock/sector concentration
│   ├── IExposureManager.ts
│   ├── ExposureManager.ts
│   └── SectorMapper.ts
│
├── portfolio/                            ← Cross-position correlation + heat
│   ├── IPortfolioRiskEngine.ts
│   ├── PortfolioRiskEngine.ts
│   ├── correlation/
│   │   ├── CorrelationMatrix.ts          ← 60-day Pearson; refreshed daily
│   │   └── CorrelationMatrixCache.ts
│   ├── sector/
│   │   ├── SectorCorrelationProxy.ts     ← Static NSE sector correlation table
│   │   └── NSESectorCorrelationMap.ts
│   ├── overlap/
│   │   └── OverlapDetector.ts
│   └── heat/
│       └── PortfolioHeatCalculator.ts
│
├── capital/
│   ├── ICapitalChecker.ts
│   └── CapitalChecker.ts
│
├── volatility/
│   ├── IVolatilityAnalyser.ts
│   └── VolatilityAnalyser.ts             ← ATR%, HV20, vol spike ratio
│
├── var/
│   ├── IPortfolioVaR.ts
│   └── PortfolioVaR.ts                   ← Historical simulation; 252-day lookback
│
├── drawdown/
│   ├── IDrawdownTracker.ts
│   ├── DrawdownTracker.ts                ← Rolling HWM; IST-boundary watermarks
│   └── DrawdownWatermarks.ts
│
├── regime/
│   ├── IRegimeFilter.ts
│   ├── RegimeFilter.ts
│   ├── INiftyTrendGuard.ts
│   └── NiftyTrendGuard.ts
│
├── liquidity/
│   ├── ILiquidityChecker.ts
│   └── LiquidityChecker.ts               ← Reads IMarketDataCache only (C3 compliant)
│
├── events/                               ← Swing-specific event risk
│   ├── IEventRiskChecker.ts
│   ├── EventRiskChecker.ts               ← ex-div, earnings, corp actions, AGM
│   ├── INewsImpactRiskChecker.ts
│   ├── NewsImpactRiskChecker.ts          ← Reads INewsCache only (C3 compliant)
│   ├── NullNewsImpactRiskChecker.ts      ← Default no-op
│   └── NSECorporateActionCalendar.ts
│
├── gap/                                  ← Overnight gap risk
│   ├── IOvernightGapRiskChecker.ts
│   ├── OvernightGapRiskChecker.ts
│   ├── GapHistoryAnalyser.ts             ← Historical gap freq from Phase 3 candles
│   └── VIXAdjustedGapEstimator.ts        ← VIX × beta → expected gap
│
├── market_status/                        ← F&O ban, SEBI, surveillance
│   ├── IMarketStatusChecker.ts
│   ├── MarketStatusChecker.ts
│   ├── FnOBanChecker.ts
│   ├── SEBIActionChecker.ts
│   └── CircuitFreezeChecker.ts
│
├── breaker/                              ← System halt
│   ├── ICircuitBreaker.ts
│   ├── CircuitBreaker.ts                 ← ARMED → TRIPPED → manual reset only
│   └── CircuitBreakerLog.ts
│
└── monitor/
    └── RiskMonitor.ts                    ← IRiskMonitor impl; read-only snapshot for UI
```

**Module count:** 60 files across 16 folders.  
**Interfaces:** 20 named interfaces.  
**All modules independently injectable + testable.**

---

## 2. Data Flow Diagram

```
═══════════════════════════════════════════════════════════════════════════
                    PHASE 6 — RISK ENGINE DATA FLOW
═══════════════════════════════════════════════════════════════════════════

BACKGROUND PROCESSES (run on timers — NOT in evaluate() hot path)
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 2 MarketDataService                                           │
│   Every tick  → IMarketDataCache ← L1 snapshots (bid/ask/mid)      │
│   Every 15min → MarketRiskEngine.refresh() ← Nifty/BN/VIX EMAs    │
│   Daily 09:15 → IMarketStatusChecker.refreshCache() ← F&O/SEBI     │
│   Daily 09:15 → CorrelationMatrix.refresh() ← 60d Pearson          │
│   Daily 09:15 → GapHistoryAnalyser.refresh() ← 252d gap stats      │
│   On schedule → INewsCache.scheduleRefresh() ← sentiment+impact     │
└─────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════
HOT PATH — evaluate() — must complete <50ms — ZERO I/O
═══════════════════════════════════════════════════════════════════════

PHASE 5 — Signal Engine
  │
  │  SignalEvent {
  │    signal_id, symbol_id, direction,
  │    entry_price_hint, stop_loss,
  │    kelly_fraction, strength,
  │    features: { regime, regime_confidence, indicators_snapshot }
  │  }
  │
  ▼
╔══════════════════════════════════════════════════════════════════════╗
║              ITradeApprovalEngine.evaluate()                        ║
║                                                                      ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │ STAGE 0 — Market Risk Engine                                │    ║
║  │                                                              │    ║
║  │  NiftyTrendAnalyser   → nifty_score ∈ [-1,1]               │    ║
║  │  BankNiftyTrendAnalyser → banknifty_score ∈ [-1,1]         │    ║
║  │  VIXAnalyser          → vix_score ∈ [0,1]                  │    ║
║  │  MarketRegimeAggregator:                                    │    ║
║  │    composite = 0.35×nifty + 0.25×BN + 0.25×regime          │    ║
║  │               - 0.15×vix                                    │    ║
║  │                                                              │    ║
║  │  → MarketRiskContext {                                       │    ║
║  │      market_state: STRONG_BULL|BULL|NEUTRAL|                │    ║
║  │                    CAUTION|BEAR|HIGH_VOL|CRASH              │    ║
║  │      hard_block: boolean                                     │    ║
║  │      risk_budget_multiplier: [0.0–1.0]                      │    ║
║  │      var_limit_multiplier: [0.6–1.0]                        │    ║
║  │      dd_limit_multiplier: [0.6–1.0]                         │    ║
║  │      max_positions_override: number                          │    ║
║  │    }                                                         │    ║
║  │                                                              │    ║
║  │  hard_block=true → REJECT all, reason:'market_crash' ───────┼──► REJECTED
║  └─────────────────────────────────────────────────────────────┘    ║
║                           │ context flows down                       ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │ CIRCUIT BREAKER (pre-pipeline)                              │    ║
║  │  TRIPPED → REJECT, reason:'system_halted' ──────────────────┼──► REJECTED
║  │  ARMED   → continue                                         │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
║                           │                                          ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │ STAGE 1 — Technical Validation                              │    ║
║  │                                                              │    ║
║  │  ConvictionSizer:                                            │    ║
║  │    PositionSizer → max_safe_qty (hard ceiling)              │    ║
║  │      risk_per_share = |entry - SL| or ATR×2                │    ║
║  │      raw_qty = risk_budget / risk_per_share                 │    ║
║  │               × kelly × overnight_haircut(0.8)              │    ║
║  │      max_safe_qty = min(raw_qty, capital_cap, kelly_cap)    │    ║
║  │    ConvictionScorer → multiplier ∈ [0.5,1.0]               │    ║
║  │      kelly(0.40) + strength(0.35) + regime_conf(0.25)       │    ║
║  │      × risk_budget_multiplier from context                  │    ║
║  │    approved_qty = floor(max_safe_qty × multiplier)          │    ║
║  │                                                              │    ║
║  │  CapitalChecker:                                             │    ║
║  │    approved_qty × entry_price ≤ available_cash              │    ║
║  │    open_count < max_positions_override                       │    ║
║  │                                                              │    ║
║  │  ExposureManager:                                            │    ║
║  │    stock_exposure_after ≤ max_stock_pct                     │    ║
║  │    sector_exposure_after ≤ max_sector_pct                   │    ║
║  │    net_long_after ≤ max_net_long_pct                        │    ║
║  │    → may REDUCE qty to fit                                  │    ║
║  │                                                              │    ║
║  │  PortfolioRiskEngine:                                        │    ║
║  │    OverlapDetector → block duplicate positions              │    ║
║  │    CorrelationMatrix + SectorProxy → cluster exposure       │    ║
║  │    PortfolioHeatCalculator → heat score ∈ [0,1]            │    ║
║  │    → may REDUCE qty to fit cluster budget                   │    ║
║  │                                                              │    ║
║  │  REJECT if qty=0 ───────────────────────────────────────────┼──► REJECTED
║  │  REDUCE if qty < original ──────────────────────────────────┼──► (verdict=REDUCED_SIZE)
║  └─────────────────────────────────────────────────────────────┘    ║
║                           │ qty (possibly reduced)                   ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │ STAGE 2 — Volatility Check                                  │    ║
║  │                                                              │    ║
║  │  VolatilityAnalyser:                                         │    ║
║  │    atr_pct > max_atr_pct(5%) → REJECT                       │    ║
║  │    hv_20 > max_annual_hv(80%) → REJECT                      │    ║
║  │    hv5/hv20 > spike_ratio(2.0) → REJECT                     │    ║
║  │                                                              │    ║
║  │  PortfolioVaR:                                               │    ║
║  │    historical sim VaR (252 days × all positions)             │    ║
║  │    portfolio_var_after > max_var × var_limit_multiplier      │    ║
║  │    → binary search: halve qty until fits or REJECT          │    ║
║  │                                                              │    ║
║  │  DrawdownTracker:                                            │    ║
║  │    daily_dd > max_daily × dd_limit_multiplier → REJECT      │    ║
║  │    weekly_dd > max_weekly × dd_limit_multiplier → REJECT    │    ║
║  │    monthly_dd > max_monthly × dd_limit_multiplier → REJECT  │    ║
║  │    (no partial approval on DD breach — full stop)           │    ║
║  │                                                              │    ║
║  │  REJECT if any breach ──────────────────────────────────────┼──► REJECTED
║  └─────────────────────────────────────────────────────────────┘    ║
║                           │                                          ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │ STAGE 3 — Market Regime Check                               │    ║
║  │                                                              │    ║
║  │  RegimeFilter (reads signal.features.regime — no recompute):│    ║
║  │    LONG: regime ∈ allowed_long_regimes? else REJECT         │    ║
║  │    BEAR market context: all LONG → REJECT                   │    ║
║  │    CHOPPY → REJECT                                          │    ║
║  │    HIGH_VOL → qty × vol_size_multiplier                     │    ║
║  │                                                              │    ║
║  │  NiftyTrendGuard (cache read):                               │    ║
║  │    LONG + Nifty < 200EMA × 0.95 → REJECT                    │    ║
║  │    SHORT + Nifty > 200EMA × 1.05 → REJECT                   │    ║
║  │                                                              │    ║
║  │  REJECT ────────────────────────────────────────────────────┼──► REJECTED
║  └─────────────────────────────────────────────────────────────┘    ║
║                           │                                          ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │ STAGE 4 — Liquidity Check  (IMarketDataCache reads only)    │    ║
║  │                                                              │    ║
║  │  blocked_symbols list → REJECT                              │    ║
║  │  ADT < min_adt_crore(5Cr) → REJECT                          │    ║
║  │  qty/ADV > max_adv_pct(1%) → REDUCE or REJECT              │    ║
║  │  recent circuit filter (last 5d) → REJECT                   │    ║
║  │  spread_pct > max_spread(0.5%) → REJECT [live mode]         │    ║
║  │                                                              │    ║
║  │  REJECT ────────────────────────────────────────────────────┼──► REJECTED
║  └─────────────────────────────────────────────────────────────┘    ║
║                           │                                          ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │ STAGE 5 — Swing Risk Check                                  │    ║
║  │                                                              │    ║
║  │  EventRiskChecker (Phase 3 DB cache):                        │    ║
║  │    5a. Blocklist → REJECT                                   │    ║
║  │    5b. Ex-dividend within hold_horizon → REJECT             │    ║
║  │    5c. Earnings within hold_horizon:                        │    ║
║  │          gap score EXTREME(>10%) → REJECT always            │    ║
║  │          HIGH(6-10%) → qty × 0.50                          │    ║
║  │          MEDIUM(3-6%) → qty × 0.75                         │    ║
║  │    5d. Bonus/split/rights within horizon → REJECT           │    ║
║  │    5e. AGM → log only                                       │    ║
║  │                                                              │    ║
║  │  MarketStatusChecker (daily cache):                          │    ║
║  │    5f. F&O ban → REJECT                                     │    ║
║  │    5g. SEBI action → REJECT or REDUCE per action type       │    ║
║  │    5h. GSM 5–6 → REJECT; ASM/GSM1-4 → REDUCE or LOG       │    ║
║  │                                                              │    ║
║  │  OvernightGapRiskChecker (candle cache + VIX cache):        │    ║
║  │    5i. gap_frequency, p95_gap from 252d history             │    ║
║  │    5j. VIX × beta → expected_gap_pct                        │    ║
║  │        composite score hold-duration adjusted:              │    ║
║  │        score = 1-(1-raw_score)^hold_days                    │    ║
║  │        EXTREME → REJECT; HIGH → qty×0.60; MEDIUM → qty×0.85│    ║
║  │                                                              │    ║
║  │  NewsImpactRiskChecker (INewsCache read — no-op if disabled):│   ║
║  │    5k. sentiment + impact tier → REJECT or REDUCE           │    ║
║  │                                                              │    ║
║  │  REJECT ────────────────────────────────────────────────────┼──► REJECTED
║  └─────────────────────────────────────────────────────────────┘    ║
║                           │ all stages passed                        ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │ CONFIDENCE CALCULATOR                                       │    ║
║  │                                                              │    ║
║  │  stages_score   = stages_passed / 5          (weight 0.40)  │    ║
║  │  conviction     = kelly×0.40+str×0.35+rc×0.25 (weight 0.35) │   ║
║  │  market_score   = risk_budget_multiplier     (weight 0.25)  │    ║
║  │                                                              │    ║
║  │  confidence = 0.40×stages + 0.35×conviction + 0.25×market  │    ║
║  │                                                              │    ║
║  │  if confidence < min_confidence_to_approve(0.30):           │    ║
║  │    verdict = REDUCED_SIZE (size × conf/threshold)           │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
║                           │                                          ║
╚══════════════════════════════════════════════════════════════════════╝
                            │
                            ▼
              TradeApprovalResult {
                decision:      APPROVED | REJECTED | REDUCED_SIZE,
                confidence:    0–1,
                suggestedSize: number,
                reasons:       string[],
                + audit fields
              }
                            │
                            ▼
                  PHASE 7 — Execution Engine
```

---

## 3. Interfaces Required

### 3.1 — IRiskEngine (master interface)

```typescript
// contracts/IRiskEngine.ts
// Top-level contract that Phase 7 depends on.
// Aggregates the two public surfaces of Phase 6.

export interface IRiskEngine {
  // Phase 7 entry point — evaluate a signal
  readonly approval: ITradeApprovalEngine;

  // UI + Phase 9 read surface
  readonly monitor: IRiskMonitor;

  // Lifecycle
  initialize(): Promise<void>;   // Pre-warms all caches; called at system startup
  shutdown(): Promise<void>;     // Graceful stop; flushes audit logs
}
```

### 3.2 — All Phase 6 interfaces (summary)

```typescript
// ENTRY POINTS
interface ITradeApprovalEngine {
  evaluate(signal: SignalEvent, portfolio: PortfolioSnapshot): TradeApprovalResult;
  resetForFold(): void;
}

interface IRiskMonitor {
  getSnapshot(): RiskSnapshot;
  onEquityUpdate(equity: number, ts: Date): void;
  onPositionChange(positions: readonly OpenPosition[]): void;
}

// PIPELINE
interface IRiskValidationPipeline {                    // Phase 4E frozen
  validate(signal: SignalEvent, portfolio: PortfolioSnapshot): RiskValidationResult;
  resetForFold(): void;
}

interface IRiskStage {
  validate(signal, portfolio, qty, config, context?: MarketRiskContext): StageValidationResult;
  resetForFold?(): void;
}

// STAGE 0
interface IMarketRiskEngine {
  getContext(): MarketRiskContext;                     // O(1) cache read
  refresh(): Promise<MarketRiskContext>;              // Background only
  onVIXSpike(vix: number): void;
  resetForFold(): void;
}

// STAGE 1
interface IPositionSizer {
  size(input: SizerInput): SizerOutput;
}
interface IConvictionScorer {
  score(components: ConvictionComponents, config: ConvictionConfig): ConvictionScore;
}
interface IExposureManager {
  check(symbol_id, sector, direction, qty, price, portfolio, config): ExposureCheckResult;
  resetForFold(): void;
}
interface ICapitalChecker {
  check(qty, price, available_cash, open_count, config): { passed: boolean; reason?: string };
}
interface IPortfolioRiskEngine {
  check(signal, qty, portfolio, account_balance, config): PortfolioRiskCheckResult;
  onHistoricalReturnsUpdate(returns: readonly DailyReturn[]): void;
  resetForFold(): void;
}

// STAGE 2
interface IVolatilityAnalyser {
  analyse(symbol_id: string, entry_price: number): VolatilityMetrics;
}
interface IPortfolioVaR {
  check(proposed_qty, signal, portfolio, account_balance, config): VaRCheckResult;
  onHistoricalReturnsUpdate(returns: readonly DailyReturn[]): void;
  resetForFold(): void;
}
interface IDrawdownTracker {
  onEquityUpdate(equity: number, ts: Date): void;
  check(config: RiskConfig): DrawdownCheckResult;
  getState(): DrawdownState;
  resetForFold(): void;
}

// STAGE 3
interface IRegimeFilter {
  check(regime, direction, qty, config, context): StageValidationResult;
}
interface INiftyTrendGuard {
  check(direction: Direction, config: RiskConfig): { passed: boolean; reason?: string };
}

// STAGE 4
interface ILiquidityChecker {
  check(symbol_id, qty, entry_price, config, mode): LiquidityCheckResult;
}

// STAGE 5
interface IEventRiskChecker {
  check(symbol_id: string, qty: number, config: SwingRiskConfig): StageValidationResult;
}
interface IOvernightGapRiskChecker {
  check(symbol_id, qty, entry_price, account_balance, config): OvernightGapCheckResult;
  resetForFold(): void;
}
interface IMarketStatusChecker {
  check(symbol_id: string, config: SwingRiskConfig): MarketStatusCheckResult;
}
interface INewsImpactRiskChecker {
  check(symbol_id, direction, qty, config): StageValidationResult;
  isEnabled(): boolean;
}

// SYSTEM
interface ICircuitBreaker {
  isArmed(): boolean;
  getState(): CircuitBreakerState;
  trip(reason: string): void;                         // Phase 9 can call this
  reset(operator_id: string, note: string): void;
  hold(operator_id: string, reason: string): void;
  release(operator_id: string): void;
  onEvent(handler: (e: CircuitBreakerEvent) => void): void;
  resetForFold(): void;
}

interface IConfidenceCalculator {
  compute(input: ConfidenceInput): number;             // [0, 1]
}

// CACHES (C3 compliance)
interface IMarketDataCache {
  getL1Snapshot(symbol_id: string): L1Snapshot | null;
  getADV(symbol_id: string): number | null;
  getADT(symbol_id: string): number | null;
  getNiftyL1(): L1Snapshot | null;
  getVIX(): number | null;
}

interface INewsCache {
  getAssessment(symbol_id: string): NewsImpactAssessment | null;
  scheduleRefresh(symbol_ids: string[]): void;
}
```

---

## 4. Database Extensions

All additive. Zero modifications to Phase 3 schema.

```sql
-- ── NEW TABLES ────────────────────────────────────────────────────────

-- Periodic risk snapshots (audit trail; Phase 9 monitoring)
CREATE TABLE risk_snapshots (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_run_id           UUID REFERENCES strategy_runs(id),
  captured_at               TIMESTAMPTZ NOT NULL,
  market_state              TEXT NOT NULL,
  risk_budget_multiplier    NUMERIC(4,3) NOT NULL,
  daily_dd_pct              NUMERIC(6,3) NOT NULL,
  weekly_dd_pct             NUMERIC(6,3) NOT NULL,
  monthly_dd_pct            NUMERIC(6,3) NOT NULL,
  total_dd_pct              NUMERIC(6,3) NOT NULL,
  net_long_exposure_pct     NUMERIC(6,3) NOT NULL,
  largest_stock_pct         NUMERIC(6,3) NOT NULL,
  largest_sector_pct        NUMERIC(6,3) NOT NULL,
  portfolio_var_1d_95_pct   NUMERIC(6,3) NOT NULL,
  portfolio_heat            NUMERIC(4,3),
  circuit_breaker_state     TEXT NOT NULL,
  open_position_count       INT NOT NULL,
  snapshot_type             TEXT NOT NULL,      -- 'periodic'|'on_trip'|'on_signal'
  detail                    JSONB
);
CREATE INDEX idx_risk_snapshots_run
  ON risk_snapshots(strategy_run_id, captured_at DESC);

-- Per-signal exposure state after Stage 1 validation
CREATE TABLE exposure_log (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id                 UUID REFERENCES signals(id),
  logged_at                 TIMESTAMPTZ NOT NULL,
  symbol_id                 UUID REFERENCES symbols(id),
  sector                    TEXT NOT NULL,
  stock_exposure_before_pct NUMERIC(6,3) NOT NULL,
  stock_exposure_after_pct  NUMERIC(6,3) NOT NULL,
  sector_exposure_after_pct NUMERIC(6,3) NOT NULL,
  net_long_after_pct        NUMERIC(6,3) NOT NULL,
  approved_qty              INT NOT NULL,
  partial_fill              BOOLEAN NOT NULL DEFAULT FALSE
);

-- Drawdown watermark transitions + breaches
CREATE TABLE drawdown_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_run_id  UUID REFERENCES strategy_runs(id),
  logged_at        TIMESTAMPTZ NOT NULL,
  event_type       TEXT NOT NULL,        -- 'hwm_update'|'limit_breach'|'watermark_reset'
  horizon          TEXT NOT NULL,        -- 'daily'|'weekly'|'monthly'|'total'
  equity           NUMERIC(15,2) NOT NULL,
  hwm              NUMERIC(15,2) NOT NULL,
  dd_pct           NUMERIC(6,3) NOT NULL,
  limit_pct        NUMERIC(6,3),
  detail           TEXT
);
CREATE INDEX idx_drawdown_log_run
  ON drawdown_log(strategy_run_id, logged_at DESC);

-- NSE/SEBI regulatory status per symbol per date
CREATE TABLE market_status (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id    UUID REFERENCES symbols(id),
  status_date  DATE NOT NULL,
  status_type  TEXT NOT NULL,
  -- 'FNO_BAN'|'ASM'|'GSM_1'..'GSM_6'|'T2T'|'CIRCUIT_FREEZE'
  detail       TEXT,
  source       TEXT NOT NULL             -- 'NSE_BHAV'|'NSE_SURVEILLANCE'|'MANUAL'
);
CREATE UNIQUE INDEX idx_market_status_sym_date_type
  ON market_status(symbol_id, status_date, status_type);

-- SEBI enforcement actions
CREATE TABLE sebi_actions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id      UUID REFERENCES symbols(id),
  action_type    TEXT NOT NULL,
  -- 'TRADING_HALT'|'TRADING_RESTRICTION'|'INVESTIGATION_OPEN'|
  -- 'FREEZE_ORDER'|'INSIDER_TRADING_PROBE'|'SHOW_CAUSE_NOTICE'
  effective_date DATE NOT NULL,
  lifted_date    DATE,                   -- null = still active
  detail         TEXT,
  source_url     TEXT
);
CREATE INDEX idx_sebi_actions_sym
  ON sebi_actions(symbol_id, effective_date);

-- ── READ-ONLY (Phase 3 tables Phase 6 reads but never writes) ─────────
-- corporate_events   (earnings dates, ex-div dates, corp actions)
-- candles            (OHLCV for VaR, gap history, EMA, correlation)
-- symbols            (sector mapping)
-- strategy_runs      (foreign key target for logs)
-- signals            (foreign key target for exposure_log)
```

**Summary:** 5 new tables, 6 new indexes. All additive.

---

## 5. Risk Decision Flow

```
FOR EACH SignalEvent from Phase 5:

┌─ GATE 0: Market crash? ───────────────────────────────────────────────┐
│  VIX > 35 OR Nifty > 15% below 200EMA                                │
│  YES → REJECTED(market_crash) ← no further evaluation                │
└───────────────────────────────────────────────────────────────────────┘
                    │ NO
┌─ GATE CB: Circuit breaker tripped? ───────────────────────────────────┐
│  CircuitBreaker.isArmed() = false                                     │
│  YES → REJECTED(system_halted) ← no further evaluation               │
└───────────────────────────────────────────────────────────────────────┘
                    │ NO
┌─ STAGE 1: Can we size this trade? ────────────────────────────────────┐
│  qty = kelly × ATR-risk × conviction × market_multiplier              │
│  qty = min(qty, capital_cap, kelly_cap)                               │
│  qty reduced by exposure limits (stock/sector/net-long)               │
│  qty reduced by portfolio correlation cluster limit                   │
│  qty = 0? → REJECTED(qty_below_min / exposure limit)                 │
│  qty < original? → mark REDUCED_SIZE, continue                       │
└───────────────────────────────────────────────────────────────────────┘
                    │ qty > 0
┌─ STAGE 2: Is volatility acceptable? ──────────────────────────────────┐
│  ATR% > 5%? → REJECTED(atr_too_high)                                 │
│  HV20 > 80%? → REJECTED(hv_too_high)                                 │
│  Vol spike ratio > 2.0? → REJECTED(vol_spike)                        │
│  Portfolio VaR after > limit? → reduce qty (binary search) or REJECT │
│  Daily/weekly/monthly DD breached? → REJECTED (no partial approval)  │
└───────────────────────────────────────────────────────────────────────┘
                    │ PASS
┌─ STAGE 3: Does market regime allow this signal? ───────────────────────┐
│  signal.regime ∉ allowed_regimes_for_direction? → REJECTED            │
│  CHOPPY regime? → REJECTED(choppy_regime)                             │
│  HIGH_VOL regime? → qty × 0.5 → REDUCED_SIZE                         │
│  BEAR context + LONG signal? → REJECTED(index_bear_trend)             │
└───────────────────────────────────────────────────────────────────────┘
                    │ PASS
┌─ STAGE 4: Is stock liquid enough? ────────────────────────────────────┐
│  Symbol blocklisted? → REJECTED(symbol_blocked)                       │
│  ADT < 5Cr? → REJECTED(insufficient_turnover)                        │
│  qty > 1% of ADV? → reduce qty or REJECTED(low_adv)                  │
│  Recent circuit filter? → REJECTED(recent_circuit_filter)            │
│  Spread > 0.5%? → REJECTED(spread_too_wide) [live only]              │
└───────────────────────────────────────────────────────────────────────┘
                    │ PASS
┌─ STAGE 5: Are swing-specific risks acceptable? ────────────────────────┐
│  Ex-dividend in next 20 days? → REJECTED(ex_dividend_window)          │
│  Earnings with gap score EXTREME? → REJECTED(earnings_blackout)       │
│  Earnings HIGH/MEDIUM? → qty × 0.50/0.75 → REDUCED_SIZE              │
│  Bonus/split/rights in horizon? → REJECTED(corporate_action_window)  │
│  F&O ban today? → REJECTED(fno_ban_active)                            │
│  SEBI restriction? → REJECTED(sebi_trading_restriction)              │
│  GSM stage 5–6? → REJECTED(gsm_stage_high)                           │
│  Overnight gap EXTREME over hold period? → REJECTED(gap_extreme)     │
│  Gap HIGH? → qty × 0.60 → REDUCED_SIZE                               │
│  News impact EXTREME? → REJECTED(news_impact_extreme) [if enabled]   │
└───────────────────────────────────────────────────────────────────────┘
                    │ ALL STAGES PASSED
┌─ CONFIDENCE: ─────────────────────────────────────────────────────────┐
│  confidence = 0.40 × (stages_passed/5)                                │
│            + 0.35 × conviction_score                                  │
│            + 0.25 × risk_budget_multiplier                            │
│                                                                        │
│  confidence < 0.30? → REDUCED_SIZE (size × conf/0.30)                │
└───────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
         verdict: APPROVED | REDUCED_SIZE
         (REJECTED exits at any gate above)
```

**Partial approval priority:** Every stage tries to REDUCE before REJECT. Only reduces to zero if reduced qty < min_tradeable_qty.

**Exception:** Drawdown breach, ex-dividend, F&O ban, GSM 5–6, SEBI halt = REJECT immediately. No partial approval on these. Capital preservation over position sizing flexibility.

---

## 6. Trade Approval Structure

### 6.1 — Output type

```typescript
export interface TradeApprovalResult {
  // Core output (spec)
  decision:      'APPROVED' | 'REJECTED' | 'REDUCED_SIZE';
  confidence:    number;          // [0,1]; always 0 for REJECTED
  suggestedSize: number;          // shares; 0 if REJECTED
  reasons:       string[];        // ordered by severity; first = most actionable

  // Audit (Phase 7 + DB logging)
  signal_id:              string;
  evaluated_at:           Date;
  market_state:           MarketState;
  risk_budget_multiplier: number;
  stage_reached:          number;  // 0=all passed; 1-5=stage that failed; 99=CB
  conviction_score:       number;
  max_safe_qty:           number;  // ceiling before all reductions
  sizing_method:          string;
}
```

### 6.2 — Reasons array examples

```
APPROVED:
  ["Approved 144 shares", "Market: STRONG_BULL (×1.00)",
   "Conviction: 78%", "Confidence: 92%"]

REDUCED_SIZE:
  ["Size reduced to 40 shares",
   "BANK sector limit: 100→80 shares",
   "Earnings gap HIGH (median 7.2%): size × 0.50",
   "Market: CAUTION (×0.50)",
   "Conviction: 61%", "Confidence: 74%"]

REJECTED:
  ["Vedanta on F&O ban list — institutional unwinding risk",
   "Stage 5 failed: fno_ban_active",
   "Market: BEAR",
   "Conviction at rejection: 60%"]
```

### 6.3 — Confidence ranges

| Range | Typical scenario |
|---|---|
| 0.80–1.00 | STRONG_BULL + all stages + high conviction |
| 0.60–0.80 | Normal market, solid signal |
| 0.40–0.60 | Reduced-size likely; moderate market |
| 0.20–0.40 | CAUTION/BEAR market or weak signal |
| 0.00 | REJECTED — always forced to zero |

---

## 7. How Phase 6 Connects to Phase 5 and Phase 7

### 7.1 — Phase 5 → Phase 6

```
Phase 5 (Signal Engine) PRODUCES:
  SignalEvent — read-only by Phase 6

Fields Phase 6 READS from SignalEvent:
  signal_id           → audit logging
  symbol_id           → all checks
  direction           → exposure, regime, news checks
  entry_price_hint    → sizing, capital check
  stop_loss           → risk_per_share calculation
  kelly_fraction      → ConvictionScorer (weight 0.40)
  strength            → ConvictionScorer (weight 0.35)
  features.regime            → Stage 3 RegimeFilter
  features.regime_confidence → ConvictionScorer (weight 0.25)
  features.indicators_snapshot.atr → PositionSizer fallback

Fields Phase 6 NEVER WRITES:
  All SignalEvent fields are readonly.
  Phase 6 does not call back into Phase 5.
  Phase 6 does not update signal.status — Phase 7 does.

Dependency direction: Phase 5 → Phase 6 (one-way)
Phase 6 imports: SignalEvent type only
Phase 6 does NOT import: SignalEngine, RegimeEngine, KellyCalculator
```

### 7.2 — Phase 6 → Phase 7

```
Phase 7 (Execution Engine) CONSUMES:
  TradeApprovalResult from ITradeApprovalEngine.evaluate()

Phase 7 integration contract:
  if result.decision === 'REJECTED':
    → ISignalRejectionWriter.markRejected(signal_id, result.reasons)
    → stop. No order submitted.

  if result.decision === 'APPROVED' or 'REDUCED_SIZE':
    → submit order for result.suggestedSize shares ONLY
    → log result to trade_log table
    → if REDUCED_SIZE: flag for review dashboard

Phase 7 rules:
  NEVER re-evaluates risk
  NEVER calls RiskValidationPipeline directly
  ALWAYS uses result.suggestedSize — never original signal qty
  NEVER submits order if confidence = 0

Dependency direction: Phase 7 → Phase 6 (one-way)
Phase 7 imports from Phase 6 barrel (index.ts):
  IRiskEngine, ITradeApprovalEngine, TradeApprovalResult
Phase 7 does NOT import any Phase 6 internals.
```

### 7.3 — Phase 9 (Safety) ↔ Phase 6

```
Phase 9 READS from Phase 6:
  IRiskMonitor.getSnapshot() → live risk dashboard

Phase 9 WRITES to Phase 6:
  ICircuitBreaker.trip(reason) → halts all new entries

Phase 6 NEVER calls Phase 9.
Dependency direction: Phase 9 → Phase 6 (one-way)
```

### 7.4 — Complete system boundary diagram

```
                    ┌─────────────────────────────┐
                    │      PHASE 5                │
                    │      Signal Engine          │
                    │                             │
                    │  Produces: SignalEvent      │
                    │  (read-only to Phase 6)     │
                    └──────────────┬──────────────┘
                                   │ SignalEvent
                    ┌──────────────▼──────────────┐
                    │      PHASE 6                │
                    │      Risk Engine            │
    Phase 9 ───────►│                             │◄─── Phase 9
    ICircuitBreaker │  Evaluates: risk only       │     IRiskMonitor
    .trip()         │  Outputs: TradeApprovalResult│    .getSnapshot()
                    │  Touches: nothing external   │
                    └──────────────┬──────────────┘
                                   │ TradeApprovalResult
                    ┌──────────────▼──────────────┐
                    │      PHASE 7                │
                    │      Execution Engine       │
                    │                             │
                    │  Submits: orders to broker  │
                    │  Uses: suggestedSize only   │
                    └─────────────────────────────┘

Phase 6 is a pure evaluation layer.
It receives signals. It returns decisions.
It touches no external systems during evaluate().
```

---

## 8. Constraint Compliance Summary

| Constraint | Status | Evidence |
|---|---|---|
| Deterministic | ✓ | No `Math.random()`. `IClockProvider` everywhere. `resetForFold()` all modules. |
| Explainable | ✓ | `reasons[]`, `stage_reached`, `reason` slug, `conviction.components`, `MarketRiskContext` all logged. |
| <50ms | ✓ | All I/O pre-cached. Hot path = pure computation. VaR worst-case ~20–30ms. |
| No trade execution | ✓ | Zero broker imports. Phase 7 owns order submission. |
| No signal generation | ✓ | `SignalEvent` read-only. No EventBus emit. |
| Risk evaluation only | ✓ | Input: SignalEvent + PortfolioSnapshot. Output: TradeApprovalResult. |

---

*Document end — Phase 6 Complete Design Reference*
