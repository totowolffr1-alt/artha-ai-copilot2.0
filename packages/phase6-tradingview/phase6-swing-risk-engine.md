# Artha AI — Phase 6: Swing Trade Risk Engine

**Document type:** Stage 5 extension — additive to Phase 6 v3  
**Status:** DESIGN COMPLETE — Implementation-ready  
**Scope:** Extends `Stage5_EventRiskCheck` with 3 new sub-modules + upgrades 2 existing ones  
**Holding period:** 2–4 weeks CNC delivery  
**Zero breaking changes:** All existing Stage 5 checks (5a–5e) retained verbatim

---

## 1. What Changes in Stage 5

### 1.1 — Before (v3)

```
Stage5_EventRiskCheck
  └── IEventRiskChecker     (5a blocklist, 5b ex-div, 5c earnings, 5d corp actions, 5e AGM)
  └── INewsSentimentFilter  (optional — disabled default)
```

### 1.2 — After (this document)

```
Stage5_SwingRiskCheck                    ← renamed to reflect swing-specific purpose
  └── IEventRiskChecker                  ← UPGRADED: adds earnings gap risk scoring
  └── IOvernightGapRiskChecker           ← NEW
  └── IMarketStatusChecker               ← NEW  (F&O ban, SEBI actions, circuit freeze)
  └── INewsImpactRiskChecker             ← UPGRADED from INewsSentimentFilter
                                            (adds impact magnitude, not just sentiment)
```

### 1.3 — Check ordering in Stage 5

```
5a–5e: IEventRiskChecker          (existing — calendar-based, cheapest)
5f–5h: IMarketStatusChecker       (DB + Phase 2 lookup — cheap)
5i–5j: IOvernightGapRiskChecker   (historical stats + VIX — medium cost)
5k:    INewsImpactRiskChecker      (external API — most expensive, last)
```

Cheap calendar/DB checks first. Expensive external calls last.

---

## 2. Module Map (additions only)

```
src/riskEngine/events/               ← existing folder
  IEventRiskChecker.ts               ← unchanged interface; impl upgraded (§4)
  EventRiskChecker.ts                ← upgraded — adds earnings gap scoring
  INewsSentimentFilter.ts            ← deprecated alias — points to INewsImpactRiskChecker
  INewsImpactRiskChecker.ts          ← NEW — replaces INewsSentimentFilter
  NewsImpactRiskChecker.ts           ← NEW
  NullNewsImpactRiskChecker.ts       ← NEW — default no-op implementation
  NSECorporateActionCalendar.ts      ← unchanged

  gap/                               ← NEW
    IOvernightGapRiskChecker.ts
    OvernightGapRiskChecker.ts
    GapHistoryAnalyser.ts            ← historical gap frequency from Phase 3 candles
    VIXAdjustedGapEstimator.ts       ← VIX × beta → expected overnight gap

  market/                            ← NEW
    IMarketStatusChecker.ts
    MarketStatusChecker.ts
    FnOBanChecker.ts                 ← NSE F&O ban list
    SEBIActionChecker.ts             ← SEBI order/investigation status
    CircuitFreezeChecker.ts          ← T2T, GSM, ASM list status
```

---

## 3. Upgraded: IEventRiskChecker

### 3.1 — What changes

Existing checks 5a–5e **unchanged**. One new sub-check added:

```
5c (upgraded): Earnings risk scoring
  Previously: binary block or size-reduce on earnings presence
  Now:        score the MAGNITUDE of historical earnings gaps
              → reject / reduce / warn based on how violently this stock
                has moved on past earnings dates
```

### 3.2 — Earnings Gap Score

```typescript
// Added to EventRiskChecker — reads Phase 3 candles around past earnings dates

interface EarningsGapScore {
  median_gap_pct: number;      // Median abs % gap on past earnings days
  max_gap_pct: number;         // Worst historical earnings gap
  gap_observations: number;    // How many past earnings dates in data
  risk_tier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
}
```

```
Tier classification (default thresholds):
  median_gap_pct < 3%  → LOW     (no size reduction if block_on_earnings = false)
  median_gap_pct 3–6%  → MEDIUM  → qty × 0.75
  median_gap_pct 6–10% → HIGH    → qty × 0.50
  median_gap_pct > 10% → EXTREME → REJECT regardless of block_on_earnings flag

If gap_observations < 3: insufficient history → treat as HIGH
```

---

## 4. New Sub-module: IOvernightGapRiskChecker

### 4.1 — Purpose

Swing positions held overnight accumulate gap risk every night. A stock that frequently gaps 3–5% overnight is far more dangerous in a 20-day hold than ATR-based sizing captures. This checker evaluates:

1. **Historical gap frequency** — how often does this stock gap significantly?
2. **VIX-adjusted expected gap** — what gap should we expect tonight given current market stress?

### 4.2 — IOvernightGapRiskChecker

```typescript
// gap/IOvernightGapRiskChecker.ts

export interface OvernightGapMetrics {
  // Historical
  gap_frequency_pct: number;       // % of nights with |gap| > gap_threshold (default 2%)
  median_gap_magnitude_pct: number;
  p95_gap_magnitude_pct: number;   // 95th percentile overnight gap
  gap_observations: number;        // Days of history analysed

  // VIX-adjusted
  vix_current: number;             // India VIX (or Nifty realised vol proxy)
  beta: number;                    // Stock beta vs Nifty50 (60-day rolling)
  expected_overnight_gap_pct: number;  // VIX-adjusted estimate for tonight

  // Composite
  gap_risk_score: number;          // [0, 1] — combined score
  risk_tier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
}

export interface OvernightGapCheckResult {
  readonly passed: boolean;
  readonly adjusted_qty: number;
  readonly metrics: OvernightGapMetrics;
  readonly reason?: string;
  readonly detail: string;
}

export interface IOvernightGapRiskChecker {
  check(
    symbol_id: string,
    qty: number,
    entry_price: number,
    account_balance: number,
    config: SwingRiskConfig
  ): OvernightGapCheckResult;
  resetForFold(): void;
}
```

### 4.3 — GapHistoryAnalyser

```
Input: Phase 3 candles — last gap_history_lookback_days (default 252) days

Overnight gap calculation per day d:
  gap_pct[d] = (open[d] - close[d-1]) / close[d-1] × 100

  Exclude:
    - Days following trading halts (gap is structural, not risk signal)
    - Ex-dividend days (gap = dividend, not risk)
    - Post-bonus/split (price discontinuity)

Metrics:
  gap_frequency_pct = count(|gap_pct| > gap_significant_threshold) / n × 100
  median_gap        = median(|gap_pct|)
  p95_gap           = percentile(|gap_pct|, 95)
```

### 4.4 — VIXAdjustedGapEstimator

```
India VIX source:
  Primary: Phase 2 MarketDataService — VIX symbol 'INDIA_VIX'
  Fallback: Nifty50 20-day realised vol (HV20) if VIX unavailable

Beta calculation:
  cov(stock_returns, nifty_returns) / var(nifty_returns)
  Using last 60 trading days from Phase 3 candles
  Clamped to [0.3, 3.0] — prevents extreme beta distortion

Expected overnight gap formula:
  daily_vix_vol   = (VIX / 100) / sqrt(252)   [daily vol from annualised VIX]
  overnight_sigma = daily_vix_vol × beta × overnight_fraction
                    (overnight_fraction default 0.40 — ~40% of daily vol occurs overnight)

  expected_gap_pct = overnight_sigma × 100 × gap_sigma_multiplier
                     (gap_sigma_multiplier default 1.65 = 95th percentile of normal dist)
```

### 4.5 — Composite Gap Risk Score

```
gap_risk_score = weight_historical × normalise(gap_frequency_pct, 0, 50)
               + weight_p95       × normalise(p95_gap_magnitude_pct, 0, 15)
               + weight_vix       × normalise(expected_overnight_gap_pct, 0, 10)

Defaults: weight_historical=0.40, weight_p95=0.35, weight_vix=0.25
All weights sum to 1.0. Score clamped to [0, 1].

Tier:
  [0.0, 0.30) → LOW      → PASS, no reduction
  [0.30, 0.55) → MEDIUM  → qty × gap_medium_size_multiplier (default 0.85)
  [0.55, 0.75) → HIGH    → qty × gap_high_size_multiplier   (default 0.60)
  [0.75, 1.0]  → EXTREME → REJECT reason: 'overnight_gap_extreme'
```

### 4.6 — Hold-duration compounding

Single-night gap risk compounds over the swing hold period. Adjust by expected hold:

```
hold_adjusted_score = 1 - (1 - gap_risk_score) ^ hold_horizon_days
```

This is the score actually compared against tier thresholds. A stock with moderate nightly gap risk is genuinely dangerous over 20 nights.

---

## 5. New Sub-module: IMarketStatusChecker

### 5.1 — Purpose

Checks three NSE/SEBI regulatory states that make a swing entry dangerous or impossible regardless of signal quality:

| Check | Source | Risk |
|---|---|---|
| F&O ban list | NSE daily ban list | Illiquidity spike + forced unwinding risk |
| SEBI action | SEBI orders DB | Trading restrictions, freeze risk |
| ASM/GSM/T2T list | NSE surveillance | Restricted trading = no normal exit |

### 5.2 — IMarketStatusChecker

```typescript
// market/IMarketStatusChecker.ts

export interface MarketStatusCheckResult {
  readonly passed: boolean;
  readonly reason?: MarketStatusReason;
  readonly detail: string;
  readonly fno_banned: boolean;
  readonly sebi_action_active: boolean;
  readonly surveillance_stage?: SurveillanceStage;
}

export type MarketStatusReason =
  | 'fno_ban_active'
  | 'sebi_trading_restriction'
  | 'sebi_investigation_open'
  | 'gsm_stage_high'
  | 'asm_list'
  | 't2t_segment';

export type SurveillanceStage =
  | 'ASM'              // Additional Surveillance Measure
  | 'GSM_1' | 'GSM_2' | 'GSM_3' | 'GSM_4' | 'GSM_5' | 'GSM_6'   // Graded Surveillance
  | 'T2T'              // Trade-to-Trade (no intraday; but swing still possible with care)
  | 'NONE';

export interface IMarketStatusChecker {
  check(symbol_id: string, config: SwingRiskConfig): MarketStatusCheckResult;
  refreshCache(): Promise<void>;   // Called daily at market open
}
```

### 5.3 — FnOBanChecker

```
Data source:
  NSE publishes daily F&O ban list (securities in ban period for F&O).
  Stored in Phase 3 table: market_status (symbol_id, date, status_type, detail)
  
  Phase 2 data feed updates this table daily via NSE bhav copy.

Check:
  REJECT if symbol in F&O ban list for today's date
  → reason: 'fno_ban_active'
  
  Rationale for swing (CNC, not F&O):
    F&O ban = stock has excessive speculative open interest.
    Institutional unwinding likely = gap down risk.
    Even CNC delivery positions face price impact from F&O unwinding.
```

### 5.4 — SEBIActionChecker

```
Data source:
  Phase 3 table: sebi_actions (symbol_id, action_type, effective_date, lifted_date, detail)
  Populated from SEBI orders page — manual update or scraped periodically.

Action types and responses:
  'TRADING_HALT'          → REJECT (cannot trade at all)
  'TRADING_RESTRICTION'   → REJECT reason: 'sebi_trading_restriction'
  'INVESTIGATION_OPEN'    → if block_on_sebi_investigation = true → REJECT
                            else → REDUCED_SIZE × sebi_investigation_multiplier (default 0.50)
  'FREEZE_ORDER'          → REJECT
  'INSIDER_TRADING_PROBE' → REJECT (worst-case: trading halted mid-hold)
  'SHOW_CAUSE_NOTICE'     → WARN only (non-blocking, logged)
```

### 5.5 — CircuitFreezeChecker

```
NSE Surveillance lists — data in Phase 3 market_status table:

ASM (Additional Surveillance Measure):
  Stage 1 → WARN only (non-blocking)
  Stage 2 → REDUCED_SIZE × 0.50

GSM (Graded Surveillance Measure):
  GSM 1–2 → WARN only
  GSM 3–4 → REDUCED_SIZE × 0.50
  GSM 5–6 → REJECT reason: 'gsm_stage_high'
  (GSM 5–6 = 5% price band. Cannot exit swing position if price moves against you.)

T2T (Trade-to-Trade):
  → WARN only for swing (T2T = no intraday netting; delivery still possible)
  → Log to risk_snapshots.detail
  → Non-blocking: CNC swing trades are already delivery; T2T doesn't add risk
```

---

## 6. Upgraded: INewsImpactRiskChecker

Replaces `INewsSentimentFilter`. Backward-compatible — same injection point.

### 6.1 — What changes

| Old (INewsSentimentFilter) | New (INewsImpactRiskChecker) |
|---|---|
| Avg sentiment score → threshold | Sentiment + estimated price impact |
| Single threshold per direction | Tier-based: LOW/MEDIUM/HIGH/EXTREME impact |
| REJECT only | REJECT or REDUCED_SIZE based on impact tier |
| No magnitude estimate | Estimates likely % price move from news |

### 6.2 — INewsImpactRiskChecker

```typescript
// events/INewsImpactRiskChecker.ts

export interface NewsImpactAssessment {
  avg_sentiment: number;            // [-1, 1]
  impact_magnitude_estimate: number; // Estimated % price impact [0, 100]
  news_volume: number;              // Count of recent news items
  impact_tier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  dominant_category: NewsCategory;
  detail: string;
}

export type NewsCategory =
  | 'EARNINGS_SURPRISE'
  | 'MANAGEMENT_CHANGE'
  | 'REGULATORY_ACTION'
  | 'DEBT_DEFAULT'
  | 'MERGER_ACQUISITION'
  | 'GENERAL_BUSINESS'
  | 'MACRO'
  | 'NONE';

export interface INewsImpactRiskChecker {
  check(
    symbol_id: string,
    direction: Direction,
    qty: number,
    config: SwingRiskConfig
  ): StageValidationResult & { assessment?: NewsImpactAssessment };
  isEnabled(): boolean;
}
```

### 6.3 — Impact estimation

```
If enabled (enable_news_filter = true):

  Fetch last news_lookback_items (default 10) news for symbol_id

  For each news item:
    sentiment_score  ∈ [-1, 1]   (from news provider)
    impact_estimate  ∈ [0, 100]  (% price impact — from news provider or category heuristic)

  Category-based impact heuristics (used if provider doesn't supply impact):
    EARNINGS_SURPRISE    → impact = |surprise_pct| × 1.5 (earnings move > surprise)
    DEBT_DEFAULT         → impact = 30–60% (severe)
    REGULATORY_ACTION    → impact = 15–40%
    MANAGEMENT_CHANGE    → impact = 5–15%
    MERGER_ACQUISITION   → impact = 10–30%
    GENERAL_BUSINESS     → impact = 1–5%
    MACRO                → impact = 0–3%

  avg_sentiment         = mean(sentiment_score[i])
  max_impact_estimate   = max(impact_estimate[i])

  Impact tier:
    max_impact < 3%   → LOW      → PASS
    max_impact 3–8%   → MEDIUM   → qty × 0.75 → REDUCED_SIZE
    max_impact 8–15%  → HIGH     → qty × 0.50 → REDUCED_SIZE
    max_impact > 15%  → EXTREME  → REJECT reason: 'news_impact_extreme'

  Sentiment override (direction-specific):
    LONG  + avg_sentiment < news_sentiment_long_threshold  (-0.3)  → REJECT
    SHORT + avg_sentiment > news_sentiment_short_threshold (+0.3)  → REJECT
    (even if impact tier would only reduce — sentiment misalign = full reject)
```

---

## 7. SwingRiskConfig (additive to RiskConfig)

```typescript
export interface SwingRiskConfig {
  // Earnings gap scoring (extends existing earnings config)
  earnings_gap_low_threshold_pct: number;     // Default 3.0
  earnings_gap_medium_threshold_pct: number;  // Default 6.0
  earnings_gap_high_threshold_pct: number;    // Default 10.0
  earnings_gap_min_observations: number;      // Default 3

  // Overnight gap
  gap_history_lookback_days: number;          // Default 252
  gap_significant_threshold_pct: number;      // Default 2.0
  gap_sigma_multiplier: number;               // Default 1.65 (95th pct)
  overnight_fraction: number;                 // Default 0.40
  gap_weight_historical: number;              // Default 0.40
  gap_weight_p95: number;                     // Default 0.35
  gap_weight_vix: number;                     // Default 0.25
  gap_medium_size_multiplier: number;         // Default 0.85
  gap_high_size_multiplier: number;           // Default 0.60

  // Market status
  block_on_fno_ban: boolean;                  // Default true
  block_on_sebi_investigation: boolean;       // Default true
  sebi_investigation_multiplier: number;      // Default 0.50
  gsm_block_stage: number;                    // Default 5 (block GSM ≥ 5)

  // News impact
  news_impact_medium_multiplier: number;      // Default 0.75
  news_impact_high_multiplier: number;        // Default 0.50
}
```

---

## 8. Full Stage 5 Check Sequence (v3 extended)

```
Stage5_SwingRiskCheck.validate(signal, portfolio, qty, config)
  │
  ├─ IEventRiskChecker (existing + earnings gap upgrade)
  │   5a. Symbol blocklist              → REJECT 'symbol_blocked'
  │   5b. Ex-dividend window            → REJECT 'ex_dividend_window'
  │   5c. Earnings blackout             → REJECT 'earnings_blackout'
  │       └─ Earnings gap score         → REJECT if EXTREME, else REDUCED_SIZE
  │   5d. Corporate action block        → REJECT 'corporate_action_window'
  │   5e. AGM/EGM                       → LOG only
  │
  ├─ IMarketStatusChecker (NEW)
  │   5f. F&O ban list                  → REJECT 'fno_ban_active'
  │   5g. SEBI action                   → REJECT or REDUCED_SIZE per action type
  │   5h. Surveillance (ASM/GSM/T2T)   → REJECT (GSM 5–6), REDUCED_SIZE (GSM 3–4), LOG (rest)
  │
  ├─ IOvernightGapRiskChecker (NEW)
  │   5i. Historical gap analysis       → gap_frequency, p95_gap, median_gap
  │   5j. VIX-adjusted gap estimate     → expected_overnight_gap_pct
  │       └─ Composite gap_risk_score   → tier → REJECT (EXTREME) or REDUCED_SIZE or PASS
  │
  └─ INewsImpactRiskChecker (UPGRADED from INewsSentimentFilter)
      5k. Sentiment + impact tier       → REJECT (EXTREME or sentiment misalign)
                                           or REDUCED_SIZE (MEDIUM/HIGH impact)
                                           or PASS (LOW impact)

→ StageValidationResult { passed, qty, stage=5, reason, detail }
```

---

## 9. Swing-specific Reason Codes (Stage 5 extended)

| Reason slug | Source | Blocking? |
|---|---|---|
| `ex_dividend_window` | 5b | REJECT |
| `earnings_blackout` | 5c | REJECT |
| `earnings_gap_extreme` | 5c upgraded | REJECT |
| `corporate_action_window` | 5d | REJECT |
| `fno_ban_active` | 5f | REJECT |
| `sebi_trading_restriction` | 5g | REJECT |
| `sebi_investigation_open` | 5g | REJECT or REDUCED |
| `gsm_stage_high` | 5h | REJECT |
| `asm_list` | 5h | REDUCED |
| `overnight_gap_extreme` | 5j | REJECT |
| `overnight_gap_high` | 5j | REDUCED |
| `news_impact_extreme` | 5k | REJECT |
| `news_sentiment_misalign` | 5k | REJECT |
| `news_impact_high` | 5k | REDUCED |

---

## 10. Governing Principles

| # | Rule |
|---|---|
| P1 | All v3 Stage 5 checks (5a–5e) retained verbatim. Zero regression. |
| P2 | Check order: cheapest first (calendar DB) → medium (market status DB) → expensive (VIX + news API). |
| P3 | Earnings gap EXTREME overrides `block_on_earnings = false`. No bypass for catastrophic movers. |
| P4 | Gap risk compounds over hold horizon via hold-duration adjustment. Single-night stats insufficient for swing. |
| P5 | F&O ban blocks CNC entry too. Institutional unwinding risk affects delivery positions. |
| P6 | T2T is non-blocking for swing (CNC = already delivery). Logged only. |
| P7 | GSM 5–6 = REJECT hard. 5% price band = no exit path if trade goes wrong. |
| P8 | `INewsImpactRiskChecker` is backward-compatible with `INewsSentimentFilter` injection point. |
| P9 | News disabled by default (`NullNewsImpactRiskChecker`). No silent external API dependency. |
| P10 | VIX source: India VIX primary, Nifty HV20 fallback. Never fails silently — fallback always available. |
| P11 | `resetForFold()` clears gap history cache + market status cache. Backtest deterministic. |
| P12 | Market status cache refreshed daily at IST 09:15. Never per-signal — too expensive. |

---

## 11. Database Additions (additive only)

```sql
-- NSE/SEBI market status per symbol per date
CREATE TABLE market_status (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id    UUID REFERENCES symbols(id),
  status_date  DATE NOT NULL,
  status_type  TEXT NOT NULL,
  -- 'FNO_BAN' | 'ASM' | 'GSM_1'..'GSM_6' | 'T2T' | 'CIRCUIT_FREEZE'
  detail       TEXT,
  source       TEXT NOT NULL   -- 'NSE_BHAV' | 'NSE_SURVEILLANCE' | 'MANUAL'
);
CREATE UNIQUE INDEX idx_market_status_sym_date_type
  ON market_status(symbol_id, status_date, status_type);

-- SEBI enforcement actions
CREATE TABLE sebi_actions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id      UUID REFERENCES symbols(id),
  action_type    TEXT NOT NULL,
  -- 'TRADING_HALT' | 'TRADING_RESTRICTION' | 'INVESTIGATION_OPEN' |
  -- 'FREEZE_ORDER' | 'INSIDER_TRADING_PROBE' | 'SHOW_CAUSE_NOTICE'
  effective_date DATE NOT NULL,
  lifted_date    DATE,          -- null = still active
  detail         TEXT,
  source_url     TEXT
);
CREATE INDEX idx_sebi_actions_sym ON sebi_actions(symbol_id, effective_date);
```

---

## 12. Worked Example — Swing Entry Blocked

```
Signal: BUY Adani Ports @ ₹800, 100 shares, hold 20 days

── 5a: Blocklist ─────────── PASS
── 5b: Ex-dividend ──────────
  Ex-date found: 12 days from today → within 20-day horizon
  REJECT: 'ex_dividend_window'
  ✗ REJECTED at 5b — no further checks needed

──────────────────────────────────────
Signal: BUY Vedanta @ ₹250, 200 shares, hold 20 days

── 5a: Blocklist ─────────── PASS
── 5b: Ex-dividend ──────────  No event → PASS
── 5c: Earnings ─────────────
  Board meeting in 18 days
  block_on_earnings = false → check earnings gap score
  Vedanta median earnings gap = 8.2% → HIGH tier
  qty × 0.50 = 100 shares → REDUCED_SIZE
── 5d: Corp actions ─────────  No event → PASS
── 5e: AGM ──────────────────  None → PASS
── 5f: F&O ban ──────────────
  Vedanta on F&O ban list today
  REJECT: 'fno_ban_active'
  ✗ REJECTED at 5f

──────────────────────────────────────
Signal: BUY Tata Motors @ ₹600, 150 shares, hold 15 days

── 5a–5e: All PASS
── 5f: F&O ban ──────────────  Not banned → PASS
── 5g: SEBI action ──────────  None active → PASS
── 5h: Surveillance ─────────  ASM Stage 1 → LOG only, PASS
── 5i–5j: Gap risk ──────────
  gap_frequency   = 18% (gaps >2% on 18% of nights)
  p95_gap         = 4.1%
  VIX = 16.5, beta = 1.45
  expected_gap    = (16.5/100/√252) × 1.45 × 0.40 × 100 × 1.65 = 1.24%

  gap_risk_score (hold-adjusted, 15 nights):
    raw  = 0.40×norm(18,0,50) + 0.35×norm(4.1,0,15) + 0.25×norm(1.24,0,10)
         = 0.40×0.36 + 0.35×0.27 + 0.25×0.12
         = 0.144 + 0.095 + 0.030 = 0.269 (raw)
    hold = 1 - (1-0.269)^15 = 1 - 0.731^15 = 1 - 0.017 = 0.983  → EXTREME

  REJECT: 'overnight_gap_extreme'
  ✗ REJECTED at 5j
  (Tata Motors' historical gap frequency + 15-night compounding = extreme risk)
```

---

*Document end — Phase 6 Swing Trade Risk Engine*
