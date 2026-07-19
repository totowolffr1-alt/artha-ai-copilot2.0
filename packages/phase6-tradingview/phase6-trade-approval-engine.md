# Artha AI — Phase 6: Trade Approval Engine

**Document type:** Final decision layer — additive to Phase 6 v3 + all extensions  
**Status:** DESIGN COMPLETE — Implementation-ready  
**Location:** `src/riskEngine/approval/`  
**Position:** Outermost layer. Called by Phase 7. Calls `RiskValidationPipeline` internally.  
**Purpose:** Orchestrate full pipeline → compute confidence → emit `TradeApprovalResult`  
**Zero breaking changes:** `RiskValidationPipeline` unchanged. `TradeApprovalEngine` wraps it.

---

## 1. Position in System

```
Phase 7 Execution Engine
  │
  └── ITradeApprovalEngine.evaluate(signal, portfolio)
        │
        ├── Stage 0: IMarketRiskEngine.getContext()       → MarketRiskContext
        ├── RiskValidationPipeline.validate()             → RiskValidationResult
        │     (Stages 0→CB→1→2→3→4→5 all run internally)
        ├── IConfidenceCalculator.compute()               → confidence ∈ [0,1]
        └── IApprovalFormatter.format()                   → TradeApprovalResult
              │
              └── {
                    decision: APPROVED | REJECTED | REDUCED_SIZE,
                    confidence: number,
                    suggestedSize: number,
                    reasons: string[]
                  }
```

Phase 7 calls `ITradeApprovalEngine` — never calls `RiskValidationPipeline` directly. Single entry point for all trade decisions.

---

## 2. Output Contract

```typescript
// approval/TradeApprovalResult.ts

export type TradeDecision = 'APPROVED' | 'REJECTED' | 'REDUCED_SIZE';

export interface TradeApprovalResult {
  // Required output shape (per spec)
  readonly decision: TradeDecision;
  readonly confidence: number;        // [0, 1]
  readonly suggestedSize: number;     // shares — 0 if REJECTED
  readonly reasons: string[];         // human-readable; ordered by severity

  // Extended audit fields (Phase 7 + logging)
  readonly signal_id: string;
  readonly evaluated_at: Date;
  readonly market_state: MarketState;
  readonly risk_budget_multiplier: number;
  readonly stage_reached: number;     // 0=all passed; 1–5=failed stage; 99=CB; 0=Stage0 block
  readonly conviction_score: number;  // raw conviction [0,1] from ConvictionScorer
  readonly max_safe_qty: number;      // ceiling before conviction scaling
  readonly sizing_method: string;     // audit trail from ConvictionSizer
}
```

---

## 3. Confidence Formula

### 3.1 — Three components (per spec: stages + conviction + market)

```
Component 1: Stages score
  stages_score = stages_passed_count / total_stages   [0, 1]

  stages_passed_count:
    APPROVED      → 5 (all passed)
    REDUCED_SIZE  → 5 (all passed; reduction happened inside stages, not via failure)
    REJECTED      → stage_failed - 1  (0 if failed Stage 1, 4 if failed Stage 5)

  Note: CircuitBreaker trip → stages_passed = 0
        Stage 0 hard block → stages_passed = 0
        total_stages = 5 (pipeline stages only; CB + Stage 0 are pre-pipeline)

Component 2: Conviction score
  conviction_score = ConvictionSizingResult.conviction.raw   [0, 1]
  (kelly × 0.40 + strength × 0.35 + regime_confidence × 0.25)

  For REJECTED signals: conviction_score = signal.kelly_fraction
  (ConvictionSizer never ran — use raw kelly as proxy)

Component 3: Market multiplier
  market_score = MarketRiskContext.risk_budget_multiplier    [0, 1]
  (STRONG_BULL=1.0, BULL=0.85, NEUTRAL=0.70 ... BEAR=0.30, CRASH=0.0)
```

### 3.2 — Composite confidence

```
raw_confidence = weight_stages     × stages_score
               + weight_conviction × conviction_score
               + weight_market     × market_score

Defaults:
  weight_stages     = 0.40   ← pipeline passage most important
  weight_conviction = 0.35   ← signal quality second
  weight_market     = 0.25   ← macro context third

confidence = clamp(raw_confidence, 0, 1)
```

### 3.3 — Confidence interpretation

| confidence | Meaning |
|---|---|
| 0.80–1.00 | High — STRONG_BULL + all stages + high conviction |
| 0.60–0.80 | Good — normal market, solid signal |
| 0.40–0.60 | Moderate — reduced size likely |
| 0.20–0.40 | Low — caution/bear market or weak signal |
| 0.00–0.20 | Very low — near-rejection territory |
| 0.00 | REJECTED |

---

## 4. Reasons Array

`reasons[]` is ordered: most severe first. Built from all pipeline stage outputs.

### 4.1 — Reasons for APPROVED / REDUCED_SIZE

```
For APPROVED:
  reasons = [
    `Market: ${market_state} (×${risk_budget_multiplier.toFixed(2)})`,
    `Conviction: ${(conviction_score * 100).toFixed(0)}%`,
    `Approved ${suggestedSize} shares @ ₹${entry_price}`,
  ]

For REDUCED_SIZE — collect all reduction reasons across stages:
  reasons = [
    `Size reduced: ${max_safe_qty} → ${suggestedSize} shares`,
    ...reduction_reasons[],   // e.g. 'Sector limit: BANK 33% → reduced to 28%'
                              //      'Market: CAUTION (×0.50)'
                              //      'Earnings gap HIGH: size × 0.50'
    `Final conviction: ${(conviction_score * 100).toFixed(0)}%`,
  ]
```

### 4.2 — Reasons for REJECTED

```
reasons = [
  primary_rejection_reason,    // e.g. 'Earnings blackout: result in 12 days'
  `Stage ${stage_failed} failed`,
  `Market: ${market_state}`,
  `Conviction at rejection: ${(conviction_score * 100).toFixed(0)}%`,
]
```

Pipeline collects `reduction_reasons[]` from each stage as it runs — even stages that reduce (not reject) contribute a reason string. These accumulate in `ApprovalContext` (internal, not part of output contract).

---

## 5. Contracts

### 5.1 — ITradeApprovalEngine

```typescript
// approval/ITradeApprovalEngine.ts

export interface ITradeApprovalEngine {
  evaluate(
    signal: SignalEvent,
    portfolio: PortfolioSnapshot
  ): TradeApprovalResult;

  resetForFold(): void;
}
```

Single method. Synchronous. All async work (VIX refresh, news API) happens on background timers — never in `evaluate()`.

### 5.2 — IConfidenceCalculator

```typescript
// approval/IConfidenceCalculator.ts

export interface ConfidenceInput {
  readonly stages_passed: number;     // 0–5
  readonly total_stages: number;      // always 5
  readonly conviction_score: number;  // [0, 1]
  readonly market_multiplier: number; // [0, 1]
  readonly config: ApprovalConfig;
}

export interface IConfidenceCalculator {
  compute(input: ConfidenceInput): number;  // [0, 1]
}
```

### 5.3 — ApprovalConfig (additive to RiskConfig)

```typescript
export interface ApprovalConfig {
  confidence_weight_stages: number;     // Default 0.40
  confidence_weight_conviction: number; // Default 0.35
  confidence_weight_market: number;     // Default 0.25
  // Weights must sum to 1.0 — validated at construction

  min_confidence_to_approve: number;    // Default 0.30
  // If confidence < min_confidence even on technical APPROVED → downgrade to REDUCED_SIZE
  // (edge case: signal passes all stages but in BEAR + low conviction)
}
```

---

## 6. TradeApprovalEngine Implementation

```typescript
// approval/TradeApprovalEngine.ts

export class TradeApprovalEngine implements ITradeApprovalEngine {
  constructor(
    private readonly pipeline: RiskValidationPipeline,
    private readonly marketRisk: IMarketRiskEngine,
    private readonly confidence: IConfidenceCalculator,
    private readonly clock: IClockProvider,
    private readonly config: RiskConfig & ApprovalConfig,
  ) {}

  evaluate(signal: SignalEvent, portfolio: PortfolioSnapshot): TradeApprovalResult {

    // 1. Get market context (cached — O(1))
    const context = this.marketRisk.getContext();

    // 2. Run full pipeline
    const result = this.pipeline.validate(signal, portfolio);

    // 3. Extract conviction score
    //    Pipeline stores last ConvictionSizer output on shared ApprovalContext
    //    (injected via PipelineContext — see §7)
    const conviction = this.pipeline.getLastConvictionScore()
                    ?? signal.kelly_fraction;  // fallback for REJECTED before Stage 1

    // 4. Compute stages passed
    const stages_passed = result.passed
      ? 5
      : Math.max(0, (result.stage === 99 ? 0 : result.stage) - 1);

    // 5. Compute confidence
    const conf = this.confidence.compute({
      stages_passed,
      total_stages: 5,
      conviction_score: conviction,
      market_multiplier: context.risk_budget_multiplier,
      config: this.config,
    });

    // 6. Confidence gate — downgrade APPROVED to REDUCED_SIZE if conf too low
    let decision: TradeDecision = result.verdict as TradeDecision;
    let suggestedSize = result.adjusted_qty;

    if (result.passed && conf < this.config.min_confidence_to_approve) {
      decision = 'REDUCED_SIZE';
      suggestedSize = Math.floor(suggestedSize * conf / this.config.min_confidence_to_approve);
      suggestedSize = Math.max(suggestedSize, 0);
    }

    // 7. Build reasons array
    const reasons = this.buildReasons(
      decision, result, context, conviction, conf, suggestedSize,
      this.pipeline.getReductionReasons()
    );

    return {
      decision,
      confidence: result.passed ? conf : 0,
      suggestedSize,
      reasons,

      // Audit
      signal_id: signal.signal_id,
      evaluated_at: this.clock.now(),
      market_state: context.market_state,
      risk_budget_multiplier: context.risk_budget_multiplier,
      stage_reached: result.stage,
      conviction_score: conviction,
      max_safe_qty: this.pipeline.getLastMaxSafeQty() ?? suggestedSize,
      sizing_method: this.pipeline.getLastSizingMethod() ?? 'unknown',
    };
  }

  private buildReasons(
    decision: TradeDecision,
    result: RiskValidationResult,
    context: MarketRiskContext,
    conviction: number,
    conf: number,
    finalQty: number,
    reductions: string[],
  ): string[] {
    if (decision === 'REJECTED') {
      return [
        result.detail,
        `Stage ${result.stage} failed: ${result.reason}`,
        `Market: ${context.market_state}`,
        `Conviction at rejection: ${(conviction * 100).toFixed(0)}%`,
      ].filter(Boolean);
    }

    if (decision === 'REDUCED_SIZE') {
      return [
        `Size reduced to ${finalQty} shares`,
        ...reductions,
        `Market: ${context.market_state} (×${context.risk_budget_multiplier.toFixed(2)})`,
        `Conviction: ${(conviction * 100).toFixed(0)}%`,
        `Confidence: ${(conf * 100).toFixed(0)}%`,
      ];
    }

    // APPROVED
    return [
      `Approved ${finalQty} shares`,
      `Market: ${context.market_state} (×${context.risk_budget_multiplier.toFixed(2)})`,
      `Conviction: ${(conviction * 100).toFixed(0)}%`,
      `Confidence: ${(conf * 100).toFixed(0)}%`,
    ];
  }

  resetForFold(): void {
    this.pipeline.resetForFold();
  }
}
```

---

## 7. Pipeline Context Threading

`RiskValidationPipeline` needs to surface three values back to `TradeApprovalEngine`:
- Last `ConvictionScore.raw`
- Last `max_safe_qty`
- `reductionReasons[]` accumulated across stages

These are stored on a **`PipelineContext`** object — created fresh per `validate()` call, passed through stages, read by `TradeApprovalEngine` after `validate()` returns.

```typescript
// pipeline/PipelineContext.ts
export class PipelineContext {
  convictionScore: number | null = null;
  maxSafeQty: number | null = null;
  sizingMethod: string | null = null;
  reductionReasons: string[] = [];

  addReduction(reason: string): void {
    this.reductionReasons.push(reason);
  }
}
```

`RiskValidationPipeline` stores last `PipelineContext` — `getLastConvictionScore()` etc. read it. Threadsafe not required — single-threaded Node.js event loop. One signal at a time per pipeline instance.

---

## 8. Module Map

```
src/riskEngine/approval/
  ITradeApprovalEngine.ts
  TradeApprovalEngine.ts
  TradeApprovalResult.ts           ← Output type (spec shape + audit fields)
  IConfidenceCalculator.ts
  ConfidenceCalculator.ts
  ApprovalConfig.ts
```

---

## 9. Worked Examples

```
Example A — APPROVED, high confidence
  Signal: BUY Reliance @ ₹2,800 | kelly=0.72 | strength=0.80 | regime_conf=0.85
  Market: STRONG_BULL | risk_budget_multiplier=1.00
  Pipeline: all 5 stages passed | max_safe_qty=150 | conviction=0.76 | final_qty=144

  stages_score   = 5/5 = 1.00
  conviction     = 0.72×0.40 + 0.80×0.35 + 0.85×0.25 = 0.288+0.280+0.213 = 0.781
  market         = 1.00

  confidence = 0.40×1.00 + 0.35×0.781 + 0.25×1.00
             = 0.400 + 0.273 + 0.250 = 0.923

  {
    decision:      'APPROVED',
    confidence:    0.923,
    suggestedSize: 144,
    reasons: [
      'Approved 144 shares',
      'Market: STRONG_BULL (×1.00)',
      'Conviction: 78%',
      'Confidence: 92%',
    ]
  }

─────────────────────────────────────────────────────────────
Example B — REDUCED_SIZE, moderate confidence
  Signal: BUY HDFC Bank @ ₹1,600 | kelly=0.55 | strength=0.60 | regime_conf=0.70
  Market: CAUTION | risk_budget_multiplier=0.50
  Pipeline: all 5 passed | max_safe_qty=100
    Stage 1 exposure reduced: BANK sector 34%→28% → qty 100→80
    Stage 5 earnings gap HIGH: × 0.50 → qty 80→40
    Final_qty=40

  stages_score   = 5/5 = 1.00
  conviction     = 0.55×0.40 + 0.60×0.35 + 0.70×0.25 = 0.220+0.210+0.175 = 0.605
  market         = 0.50

  confidence = 0.40×1.00 + 0.35×0.605 + 0.25×0.50
             = 0.400 + 0.212 + 0.125 = 0.737

  {
    decision:      'REDUCED_SIZE',
    confidence:    0.737,
    suggestedSize: 40,
    reasons: [
      'Size reduced to 40 shares',
      'BANK sector limit: reduced 100→80 shares',
      'Earnings gap HIGH (median 7.2%): size × 0.50',
      'Market: CAUTION (×0.50)',
      'Conviction: 61%',
      'Confidence: 74%',
    ]
  }

─────────────────────────────────────────────────────────────
Example C — REJECTED
  Signal: BUY Vedanta @ ₹250
  Market: BEAR | risk_budget_multiplier=0.30
  Pipeline: Stage 5 rejected — F&O ban active

  stages_score   = (5-1)/5 = 0.80   (reached Stage 5, failed there)
  conviction     = signal.kelly_fraction = 0.60  (fallback — ConvictionSizer never ran)
  market         = 0.30

  confidence (not used for REJECTED — forced to 0)

  {
    decision:      'REJECTED',
    confidence:    0,
    suggestedSize: 0,
    reasons: [
      'Vedanta on F&O ban list — institutional unwinding risk',
      'Stage 5 failed: fno_ban_active',
      'Market: BEAR',
      'Conviction at rejection: 60%',
    ]
  }
```

---

## 10. Governing Principles

| # | Rule |
|---|---|
| P1 | Phase 7 calls `ITradeApprovalEngine` only. Never calls `RiskValidationPipeline` directly. |
| P2 | `confidence = 0` always for REJECTED. No false signal about a blocked trade. |
| P3 | Low confidence on technically APPROVED signal → downgrade to REDUCED_SIZE via `min_confidence_to_approve`. |
| P4 | `reasons[]` ordered severity-first. First item always most actionable. |
| P5 | `evaluate()` is synchronous. All I/O (VIX, news) on background timers only. |
| P6 | `PipelineContext` is per-call. No cross-signal state pollution. |
| P7 | Confidence weights must sum to 1.0. Validated at construction. Hard error if not. |
| P8 | `suggestedSize` = `adjusted_qty` from pipeline × confidence gate. Phase 7 uses this verbatim. |
| P9 | `resetForFold()` delegates to pipeline. Backtest fold boundaries clean all state. |
| P10 | `TradeApprovalResult` is the only object Phase 7 sees. All internal types stay inside Phase 6. |

---

## 11. Phase 7 Integration Contract

Phase 7 receives `TradeApprovalResult`. Its responsibilities:

```
if result.decision === 'REJECTED':
  → ISignalRejectionWriter.markRejected(signal_id, result.reasons)
  → stop

if result.decision === 'APPROVED' or 'REDUCED_SIZE':
  → submit order for result.suggestedSize shares
  → log result.confidence + result.reasons to trade_log table
  → if decision === 'REDUCED_SIZE': flag for review dashboard
```

Phase 7 **never re-evaluates risk**. It trusts `suggestedSize` completely.

---

*Document end — Phase 6 Trade Approval Engine*
