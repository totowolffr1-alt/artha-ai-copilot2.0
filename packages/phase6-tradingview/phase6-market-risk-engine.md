# Artha AI — Phase 6: Market Risk Engine (Stage 0)

**Document type:** Pre-pipeline stage design — additive to Phase 6 v3  
**Status:** DESIGN COMPLETE — Implementation-ready  
**Location:** `src/riskEngine/market/`  
**Position:** Stage 0 — runs BEFORE CircuitBreaker, BEFORE all 5 pipeline stages  
**Output:** `MarketRiskContext` — a multiplier envelope consumed by all downstream stages  
**Relationship to Stage 3:** Stage 3 (`IRegimeFilter` + `INiftyTrendGuard`) is retained unchanged. Stage 0 is macro-level; Stage 3 is signal-level. Both run; Stage 0 first.

---

## 1. Conceptual Model

```
Stage 0 answers: "What kind of market are we in RIGHT NOW?"
Stage 3 answers: "Is THIS SIGNAL aligned with that market?"

Stage 0 output (MarketRiskContext) flows into Stage 3 + all other stages.
Stage 3 uses it to tighten/relax regime alignment rules.
Stage 1 uses it to scale position sizing budget.
Stage 2 uses it to tighten VaR + DD limits.
```

Two-tier logic:

```
Tier 1 — Binary gate (extreme conditions → REJECT ALL signals):
  VIX > extreme_vix_threshold         → halt all new entries
  Nifty crash (> max_nifty_dd_pct)   → halt all new entries
  Market regime = CRASH               → halt all new entries

Tier 2 — Scalar scaling (moderate conditions → scale risk budget):
  risk_budget_multiplier ∈ [min_multiplier, 1.0]
  Applied by Stage 1 to max_risk_per_trade and max_capital_per_trade
  Applied by Stage 2 to max_portfolio_var_pct and DD limits
```

---

## 2. Architecture

### 2.1 — Full Pipeline (updated)

```
SignalEvent (Phase 5)
  │
  ▼
┌─────────────────────────────────────────────┐
│  Stage 0: Market Risk Engine                │  ← NEW — runs first
│    └─ INiftyTrendAnalyser                   │
│    └─ IBankNiftyTrendAnalyser               │
│    └─ IVIXAnalyser                          │
│    └─ IMarketRegimeAggregator               │
│                                             │
│  → MarketRiskContext {                      │
│      market_state,                          │
│      risk_budget_multiplier,                │
│      max_positions_override,                │
│      hard_block: boolean                    │
│    }                                        │
└──────────────┬──────────────────────────────┘
               │ hard_block = true → REJECT all (stage=0)
               │ hard_block = false → context flows downstream
               ▼
┌─────────────────────────┐
│   ICircuitBreaker gate  │  ← existing, unchanged
└──────────┬──────────────┘
           │ ARMED
           ▼
┌──────────────────────────────────────────────────────────┐
│  Stage 1: Technical Validation                           │
│    Uses: context.risk_budget_multiplier on sizing        │
│                                                          │
│  Stage 2: Volatility Check                               │
│    Uses: context.risk_budget_multiplier on VaR/DD limits │
│                                                          │
│  Stage 3: Market Regime Check  ← UPGRADED               │
│    Uses: context.market_state to tighten/relax filters   │
│                                                          │
│  Stage 4: Liquidity Check      ← unchanged              │
│  Stage 5: Swing Risk Check     ← unchanged              │
└──────────────────────────────────────────────────────────┘
```

### 2.2 — Module Map

```
src/riskEngine/market/
  IMarketRiskEngine.ts
  MarketRiskEngine.ts              ← Stage 0 implementation
  MarketRiskContext.ts             ← Output type; flows through all stages

  indices/
    INiftyTrendAnalyser.ts
    NiftyTrendAnalyser.ts          ← Nifty50 trend: price vs EMAs + breadth
    IBankNiftyTrendAnalyser.ts
    BankNiftyTrendAnalyser.ts      ← BankNifty trend: price vs EMAs + divergence

  vix/
    IVIXAnalyser.ts
    VIXAnalyser.ts                 ← India VIX: level + trend + spike detection

  regime/
    IMarketRegimeAggregator.ts
    MarketRegimeAggregator.ts      ← Combines Nifty + BankNifty + VIX + Phase 5 regime
                                      → MarketState enum + risk_budget_multiplier
```

---

## 3. Output: MarketRiskContext

```typescript
// market/MarketRiskContext.ts

export type MarketState =
  | 'STRONG_BULL'        // All inputs aligned bullish — allow max allocation
  | 'BULL'               // Bullish trend, moderate confidence
  | 'NEUTRAL'            // Mixed signals — normal allocation
  | 'CAUTION'            // Bearish drift or rising VIX — reduce risk
  | 'BEAR'               // Clear bearish trend — significantly reduce
  | 'HIGH_VOLATILITY'    // VIX spike regardless of trend — reduce exposure
  | 'CRASH'              // Extreme: hard block all new entries

export interface MarketRiskContext {
  // Core
  readonly market_state: MarketState;
  readonly hard_block: boolean;             // true = REJECT all signals (CRASH state)
  readonly hard_block_reason?: string;

  // Multipliers (all ∈ [0, 1])
  readonly risk_budget_multiplier: number;  // Scales max_risk_per_trade_pct + max_capital_per_trade_pct
  readonly var_limit_multiplier: number;    // Scales max_portfolio_var_pct (tighten in stress)
  readonly dd_limit_multiplier: number;     // Scales DD limits (tighten in bear/high-vol)
  readonly max_positions_override: number;  // Override max_open_trades (reduce in bear)

  // Component scores (audit)
  readonly nifty_score: number;             // [-1, 1]
  readonly banknifty_score: number;         // [-1, 1]
  readonly vix_score: number;               // [0, 1] — 0=calm, 1=extreme
  readonly regime_score: number;            // [-1, 1] from Phase 5 regime field

  // Raw inputs (for monitor + logging)
  readonly nifty_price: number;
  readonly nifty_ema20: number;
  readonly nifty_ema50: number;
  readonly nifty_ema200: number;
  readonly banknifty_price: number;
  readonly banknifty_ema20: number;
  readonly vix_current: number;
  readonly vix_20d_avg: number;
  readonly captured_at: Date;
}
```

---

## 4. Sub-module: INiftyTrendAnalyser

### 4.1 — Inputs

From Phase 2 `IMarketDataService`:
- Nifty50 OHLCV (daily candles, last 252 days from Phase 3)
- Nifty50 current price (live)

### 4.2 — Trend Score Algorithm

```
Compute EMAs from Phase 3 daily candles:
  EMA20, EMA50, EMA200 of Nifty50 close

Price position score (each contributes to nifty_score):
  price > EMA20  → +0.20
  price > EMA50  → +0.25
  price > EMA200 → +0.30
  EMA20 > EMA50  → +0.15  (short-term trend above medium-term)
  EMA50 > EMA200 → +0.10  (medium-term above long-term = structural bull)

  Raw score = sum of conditions ∈ [0, 1.0]
  nifty_score = (raw_score × 2) - 1   → [-1, 1]
  (maps 0→-1, 0.5→0, 1.0→+1)

Crash detection:
  nifty_crash = price < EMA200 × (1 - crash_nifty_dd_threshold)
  (default crash_nifty_dd_threshold: 0.15 — Nifty >15% below 200EMA = crash)
```

### 4.3 — Nifty Trend States

| nifty_score | State |
|---|---|
| ≥ 0.60 | STRONG_BULL |
| 0.20 to 0.60 | BULL |
| -0.20 to 0.20 | NEUTRAL |
| -0.60 to -0.20 | BEAR |
| < -0.60 | STRONG_BEAR |
| crash detected | CRASH |

---

## 5. Sub-module: IBankNiftyTrendAnalyser

### 5.1 — Why BankNifty separately

BankNifty leads Nifty50. BankNifty divergence from Nifty is a leading risk signal:
- BankNifty falling while Nifty flat = financial stress brewing
- BankNifty rising while Nifty flat = selective sector strength (less systemic risk)

### 5.2 — Trend Score Algorithm

Same EMA structure as Nifty (EMA20/50/200). Identical scoring formula → `banknifty_score ∈ [-1, 1]`.

**Divergence detection:**

```
divergence = nifty_score - banknifty_score

If divergence > banknifty_divergence_threshold (default 0.40):
  → BankNifty significantly lagging Nifty
  → Financial sector stress signal
  → Contributes to CAUTION or BEAR state in aggregator
  → Caps risk_budget_multiplier at banknifty_lag_cap (default 0.70)

If divergence < -banknifty_divergence_threshold:
  → BankNifty leading Nifty (bullish breadth confirmation)
  → Positive signal — no cap
```

---

## 6. Sub-module: IVIXAnalyser

### 6.1 — Inputs

- India VIX current value (Phase 2 live feed)
- India VIX 20-day average (Phase 3 candles)
- India VIX 52-week high/low (Phase 3 candles)

### 6.2 — VIX Score Algorithm

```
VIX level score:
  vix_pct_of_52w_range = (vix_current - vix_52w_low) / (vix_52w_high - vix_52w_low)
  → normalised position in annual range [0, 1]

VIX trend score:
  vix_above_avg = vix_current > vix_20d_avg
  vix_trend_ratio = vix_current / vix_20d_avg
  spike = vix_trend_ratio > vix_spike_ratio_threshold (default 1.40 — VIX 40% above 20d avg)

vix_score = 0.60 × vix_pct_of_52w_range
           + 0.40 × min(vix_trend_ratio / 2.0, 1.0)

vix_score ∈ [0, 1]
  0.0 → VIX at 52w low, calm, stable
  1.0 → VIX at 52w high, spiking
```

### 6.3 — VIX Thresholds (absolute + relative)

```
Absolute thresholds (India VIX levels):
  vix_current < 13          → CALM
  vix_current 13–18         → NORMAL
  vix_current 18–24         → ELEVATED
  vix_current 24–30         → HIGH
  vix_current > 30          → EXTREME → hard_block candidate

Relative threshold:
  vix_spike (ratio > 1.40)  → add CAUTION regardless of absolute level
  (VIX jumping from 12→17 is more significant than VIX steady at 20)
```

---

## 7. Sub-module: IMarketRegimeAggregator

### 7.1 — Purpose

Combines four inputs into one `MarketState` + `risk_budget_multiplier`.

```
Inputs:
  nifty_score       ∈ [-1, 1]   (from NiftyTrendAnalyser)
  banknifty_score   ∈ [-1, 1]   (from BankNiftyTrendAnalyser)
  vix_score         ∈ [0, 1]    (from VIXAnalyser)
  regime_score      ∈ [-1, 1]   (from signal.features.regime — Phase 5)
```

### 7.2 — Composite Market Score

```
composite = weight_nifty      × nifty_score
           + weight_banknifty  × banknifty_score
           + weight_regime     × regime_score
           - weight_vix        × vix_score    ← subtracted: high VIX = bearish

Defaults:
  weight_nifty      = 0.35
  weight_banknifty  = 0.25
  weight_regime     = 0.25
  weight_vix        = 0.15
  (sum of magnitudes = 1.0)

composite ∈ [-1, 1]
```

### 7.3 — MarketState Classification

| Condition | MarketState | hard_block |
|---|---|---|
| nifty CRASH or vix_current > extreme_vix (default 35) | `CRASH` | **true** |
| composite ≥ 0.55 AND vix_score < 0.40 | `STRONG_BULL` | false |
| composite ≥ 0.20 AND vix_score < 0.60 | `BULL` | false |
| vix_score ≥ 0.75 (regardless of trend) | `HIGH_VOLATILITY` | false |
| composite between -0.20 and 0.20 | `NEUTRAL` | false |
| composite between -0.55 and -0.20 | `CAUTION` | false |
| composite < -0.55 | `BEAR` | false |

Priority order: CRASH check first → HIGH_VOLATILITY → composite-based.

### 7.4 — Risk Budget Multiplier Table

```
MarketState         risk_budget_multiplier   var_limit_multiplier   dd_limit_multiplier   max_positions_override
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
STRONG_BULL         1.00                     1.00                   1.00                  config.max_open_trades
BULL                0.85                     1.00                   1.00                  config.max_open_trades
NEUTRAL             0.70                     0.90                   0.90                  config.max_open_trades
CAUTION             0.50                     0.75                   0.75                  floor(max × 0.75)
BEAR                0.30                     0.60                   0.60                  floor(max × 0.50)
HIGH_VOLATILITY     0.40                     0.65                   0.70                  floor(max × 0.60)
CRASH               0.00                     —                      —                     0  (hard_block=true)
```

All multipliers configurable in `MarketRiskConfig`. Table above = defaults.

BankNifty divergence cap: if divergence triggered, cap `risk_budget_multiplier` at `banknifty_lag_cap` regardless of MarketState (prevents STRONG_BULL full allocation when financials lag).

---

## 8. How Downstream Stages Use MarketRiskContext

### Stage 1 — Technical Validation (sizing)

```typescript
// Inside PositionSizer / ConvictionSizer:
effective_max_risk_pct     = config.max_risk_per_trade_pct     × context.risk_budget_multiplier
effective_max_capital_pct  = config.max_capital_per_trade_pct  × context.risk_budget_multiplier

// Also: max_open_trades uses context.max_positions_override
```

### Stage 2 — Volatility Check

```typescript
effective_max_var_pct      = config.max_portfolio_var_pct  × context.var_limit_multiplier
effective_max_daily_dd     = config.max_daily_drawdown_pct  × context.dd_limit_multiplier
effective_max_weekly_dd    = config.max_weekly_drawdown_pct × context.dd_limit_multiplier
effective_max_monthly_dd   = config.max_monthly_drawdown_pct× context.dd_limit_multiplier
```

In BEAR state: DD limits tighten to 60% of config values. Drawdown budget shrinks — system stops adding risk faster.

### Stage 3 — Market Regime Check (upgraded)

```typescript
// IRegimeFilter now receives MarketRiskContext — uses it to tighten/relax allowed regimes

In STRONG_BULL:
  allowed_long_regimes expanded to include BULL_RANGING (looser — trend confirmed macro)

In CAUTION:
  allowed_long_regimes narrowed to BULL_TRENDING only (stricter — need strong signal to enter)

In BEAR:
  all LONG signals REJECTED at Stage 3 regardless of signal.regime
  (Stage 0 BEAR + Stage 3 enforce belt-and-suspenders)

In HIGH_VOLATILITY:
  vol_regime_size_multiplier overridden by context.risk_budget_multiplier
  (context already accounts for VIX — Stage 3 multiplier becomes redundant but harmless)
```

Stages 4 and 5 — unchanged. Liquidity and event checks are signal-specific, not market-state-driven.

---

## 9. MarketRiskContext Caching

Stage 0 is **NOT called per signal**. Called once per:
- `market_context_refresh_interval_minutes` (default 15 — IST market hours only)
- On demand if VIX spikes > `vix_spike_cache_invalidation_ratio` (default 1.25 intraday)

```typescript
export interface IMarketRiskEngine {
  getContext(): MarketRiskContext;           // Returns cached — O(1) per signal
  refresh(): Promise<MarketRiskContext>;    // Calls Phase 2 + computes fresh context
  onVIXSpike(vix_value: number): void;      // Phase 2 pushes VIX updates; triggers refresh if spike
  resetForFold(): void;
}
```

`RiskValidationPipeline` calls `getContext()` at start of each `validate()` — cheap cache hit. Context refresh happens on its own timer via `IClockProvider`, not in the hot path.

---

## 10. Updated Pipeline Composition

```typescript
// pipeline/RiskValidationPipeline.ts (updated)

export class RiskValidationPipeline implements IRiskValidationPipeline {
  constructor(
    private readonly marketRisk: IMarketRiskEngine,  // Stage 0 — NEW
    private readonly stage1: Stage1_TechnicalValidation,
    private readonly stage2: Stage2_VolatilityCheck,
    private readonly stage3: Stage3_MarketRegimeCheck,
    private readonly stage4: Stage4_LiquidityCheck,
    private readonly stage5: Stage5_SwingRiskCheck,
    private readonly breaker: ICircuitBreaker,
    private readonly config: RiskConfig,
  ) {}

  validate(signal: SignalEvent, portfolio: PortfolioSnapshot): RiskValidationResult {

    // Stage 0: market risk context
    const context = this.marketRisk.getContext();
    if (context.hard_block) {
      return this.reject(0, context.hard_block_reason ?? 'market_crash',
        `Market state: ${context.market_state}`);
    }

    // Pre-pipeline: circuit breaker (unchanged position)
    if (!this.breaker.isArmed()) {
      return this.reject(99, 'system_halted', 'Circuit breaker tripped');
    }

    // Stages 1–5 — each receives context
    const stages = [
      this.stage1, this.stage2, this.stage3, this.stage4, this.stage5
    ];

    let qty = deriveInitialQty(signal, portfolio, this.config, context);
    let verdict: RiskVerdict = 'APPROVED';
    const originalQty = qty;

    for (const stage of stages) {
      const result = stage.validate(signal, portfolio, qty, this.config, context);
      if (!result.passed) return this.toResult(result, 'REJECTED');
      if (result.qty < qty) { qty = result.qty; verdict = 'REDUCED_SIZE'; }
    }

    return {
      passed: true, verdict, stage: 0,
      reason: verdict === 'APPROVED' ? 'approved' : 'size_reduced',
      adjusted_qty: qty,
      detail: `[${context.market_state} × ${context.risk_budget_multiplier.toFixed(2)}] ${qty} shares`,
    };
  }
}
```

`IRiskStage.validate()` signature gains optional `context` parameter:
```typescript
validate(signal, portfolio, qty, config, context?: MarketRiskContext): StageValidationResult
```
Optional — Stages 4 and 5 ignore it. Backward-compatible.

---

## 11. IRiskMonitor Extension

`RiskSnapshot` gains market context fields (additive):

```typescript
// Additive fields on RiskSnapshot:
readonly market_state: MarketState;
readonly risk_budget_multiplier: number;
readonly nifty_score: number;
readonly banknifty_score: number;
readonly vix_current: number;
readonly vix_score: number;
readonly banknifty_divergence: boolean;
```

Replaces Phase 1 hardcoded `Market Risk 65` gauge — now a real computed value.

---

## 12. MarketRiskConfig (additive to RiskConfig)

```typescript
export interface MarketRiskConfig {
  // Weights
  weight_nifty: number;                      // Default 0.35
  weight_banknifty: number;                  // Default 0.25
  weight_regime: number;                     // Default 0.25
  weight_vix: number;                        // Default 0.15

  // Nifty thresholds
  crash_nifty_dd_threshold: number;          // Default 0.15 (15% below 200EMA)

  // BankNifty
  banknifty_divergence_threshold: number;    // Default 0.40
  banknifty_lag_cap: number;                 // Default 0.70 (cap multiplier when BN lags)

  // VIX thresholds
  vix_extreme_threshold: number;             // Default 35.0 (hard block)
  vix_spike_ratio_threshold: number;         // Default 1.40
  vix_spike_cache_invalidation_ratio: number;// Default 1.25 (intraday spike triggers refresh)

  // Risk budget multipliers per state (all configurable)
  multiplier_strong_bull: number;            // Default 1.00
  multiplier_bull: number;                   // Default 0.85
  multiplier_neutral: number;                // Default 0.70
  multiplier_caution: number;                // Default 0.50
  multiplier_bear: number;                   // Default 0.30
  multiplier_high_volatility: number;        // Default 0.40

  // Cache
  market_context_refresh_interval_minutes: number;  // Default 15
}
```

---

## 13. Governing Principles

| # | Rule |
|---|---|
| P1 | Stage 0 runs BEFORE CircuitBreaker. CRASH = hard block before any stage runs. |
| P2 | Context cached — refreshed every 15 min, not per signal. Never in hot path. |
| P3 | `risk_budget_multiplier` only REDUCES sizing. Never inflates beyond config limits. Max = 1.0. |
| P4 | STRONG_BULL = multiplier 1.0, not >1.0. "Higher allocation" means full config limits, not beyond. |
| P5 | BankNifty divergence caps multiplier regardless of MarketState. Belt-and-suspenders for financial stress. |
| P6 | VIX spike triggers async cache invalidation. Does NOT block the current signal's validation. |
| P7 | Stage 3 (`IRegimeFilter`) still runs. Stage 0 is macro; Stage 3 is signal-specific. Both needed. |
| P8 | `IRiskStage.validate()` context param is optional. Stages 4–5 unchanged. |
| P9 | `resetForFold()` clears cached context. Backtest uses replay-time VIX + index prices. |
| P10 | No `Math.random()`. EMA computed from real Phase 3 candles. VIX from Phase 2 live feed. |

---

## 14. Worked Examples

```
Example A — STRONG_BULL market
  Nifty:     23,500 — above EMA20/50/200, all EMAs stacked  → nifty_score = +0.80
  BankNifty: 52,000 — above EMA20/50/200, leading Nifty     → banknifty_score = +0.75
  India VIX: 11.2   — below 13, at 52w low                  → vix_score = 0.05
  Phase 5 regime: BULL_TRENDING                              → regime_score = +0.80

  composite = 0.35×0.80 + 0.25×0.75 + 0.25×0.80 - 0.15×0.05
            = 0.280 + 0.188 + 0.200 - 0.008 = 0.660

  MarketState: STRONG_BULL (composite ≥ 0.55, vix_score < 0.40)
  risk_budget_multiplier: 1.00
  Result: full config limits apply — max allocation allowed

─────────────────────────────────────────────────────────
Example B — BEAR market + VIX elevated
  Nifty:     18,200 — below EMA20/50, near EMA200           → nifty_score = -0.45
  BankNifty: 38,500 — below EMA20/50/200, lagging badly     → banknifty_score = -0.70
  India VIX: 22.5   — elevated, 60% of 52w range            → vix_score = 0.64
  Phase 5 regime: BEAR_RANGING                               → regime_score = -0.50

  composite = 0.35×(-0.45) + 0.25×(-0.70) + 0.25×(-0.50) - 0.15×0.64
            = -0.158 - 0.175 - 0.125 - 0.096 = -0.554

  MarketState: CAUTION (composite = -0.554, just above BEAR threshold -0.55)
  risk_budget_multiplier: 0.50
  BankNifty divergence: (-0.45) - (-0.70) = 0.25 < 0.40 threshold → no cap

  Effect on sizing:
    max_risk_per_trade: 1.0% × 0.50 = 0.50% of account
    max_capital_per_trade: 10% × 0.50 = 5% of account
    max_portfolio_var: 4% × 0.75 = 3%
    DD limits: 3%/5%/8% → 2.25%/3.75%/6%

─────────────────────────────────────────────────────────
Example C — CRASH (VIX extreme)
  Nifty:     16,800 — 18% below 200EMA                      → CRASH detected
  India VIX: 38.5   — above extreme threshold (35)          → CRASH confirmed

  MarketState: CRASH
  hard_block: true
  hard_block_reason: 'market_crash'

  Result: ALL signals rejected at Stage 0, stage=0
  reason: 'market_crash'
  detail: 'Market state: CRASH'
  No further stages run.
```

---

*Document end — Phase 6 Market Risk Engine (Stage 0)*
