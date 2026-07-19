/**
 * packages/phase6-tradingview/src/types.ts
 * Artha AI — Phase 6 Risk Engine
 */

// ─── Import Direction and SignalEvent shape from Phase 5 ──────────────────────
export type Direction = 'LONG' | 'SHORT';

export interface SignalEvent {
  readonly signal_id:        string;          // uuid v4
  readonly symbol_id:        string;          // uuid — symbols table
  readonly strategy_run_id:  string;          // uuid — strategy_runs row
  readonly signal_type:      string;          // e.g. 'entry_long', 'entry_short'
  readonly direction:        Direction;       // 'LONG' | 'SHORT'
  readonly strength:         number;          // [0, 1]
  readonly entry_price_hint: number;          // close price at signal bar
  readonly stop_loss:        number | null;   // absolute price level
  readonly take_profit:      number | null;   // absolute price level
  readonly kelly_fraction:   number;          // [0, 1]
  readonly regime:           string;
  readonly features:         any;             // contains regime_confidence, indicators_snapshot etc.
  readonly fired_at:         Date;
}

// ─── Market Risk Context (Stage 0) ───────────────────────────────────────────
export type MarketState =
  | 'STRONG_BULL'
  | 'BULL'
  | 'NEUTRAL'
  | 'CAUTION'
  | 'BEAR'
  | 'HIGH_VOLATILITY'
  | 'CRASH';

export interface MarketRiskContext {
  readonly market_state: MarketState;
  readonly hard_block: boolean;
  readonly hard_block_reason?: string;

  // Multipliers ∈ [0, 1]
  readonly risk_budget_multiplier: number;
  readonly var_limit_multiplier: number;
  readonly dd_limit_multiplier: number;
  readonly max_positions_override: number;

  // Component scores
  readonly nifty_score: number;             // [-1, 1]
  readonly banknifty_score: number;         // [-1, 1]
  readonly vix_score: number;               // [0, 1]
  readonly regime_score: number;            // [-1, 1]

  // Raw inputs
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

// ─── Portfolio Snapshot Types ────────────────────────────────────────────────
export interface OpenPosition {
  readonly symbol_id: string;
  readonly ticker: string;
  readonly sector: string;
  readonly direction: Direction;
  readonly qty: number;
  readonly avg_cost: number;
  readonly ltp: number;
  readonly market_value: number;
  readonly margin_blocked: number;
}

export interface PortfolioSnapshot {
  readonly cash_available: number;
  readonly total_portfolio_value: number;
  readonly margin_used: number;
  readonly positions: readonly OpenPosition[];
  readonly open_trade_count: number;
  readonly peak_value: number;
}

// ─── Trade Approval Outputs ──────────────────────────────────────────────────
export type TradeDecision = 'APPROVED' | 'REJECTED' | 'REDUCED_SIZE';

export interface TradeApprovalResult {
  readonly decision: TradeDecision;
  readonly confidence: number;
  readonly suggestedSize: number;
  readonly reasons: string[];

  // Audit
  readonly signal_id: string;
  readonly evaluated_at: Date;
  readonly market_state: MarketState;
  readonly risk_budget_multiplier: number;
  readonly stage_reached: number;
  readonly conviction_score: number;
  readonly max_safe_qty: number;
  readonly sizing_method: string;
}

export type RiskVerdict = 'APPROVED' | 'REJECTED' | 'REDUCED_SIZE';

export interface RiskValidationResult {
  readonly passed: boolean;
  readonly verdict: RiskVerdict;
  readonly stage: number;
  readonly reason: string;
  readonly adjusted_qty: number;
  readonly detail: string;
}

export interface StageValidationResult {
  readonly passed: boolean;
  readonly qty: number;
  readonly reason?: string;
  readonly detail: string;
}

// ─── Stage 4 & 5 Swing/Liquidity types ───────────────────────────────────────
export type NewsCategory =
  | 'EARNINGS_SURPRISE'
  | 'MANAGEMENT_CHANGE'
  | 'REGULATORY_ACTION'
  | 'DEBT_DEFAULT'
  | 'MERGER_ACQUISITION'
  | 'GENERAL_BUSINESS'
  | 'MACRO'
  | 'NONE';

export interface NewsImpactAssessment {
  readonly avg_sentiment: number;
  readonly impact_magnitude_estimate: number;
  readonly news_volume: number;
  readonly impact_tier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  readonly dominant_category: NewsCategory;
  readonly detail: string;
}

export type SurveillanceStage =
  | 'ASM'
  | 'GSM_1' | 'GSM_2' | 'GSM_3' | 'GSM_4' | 'GSM_5' | 'GSM_6'
  | 'T2T'
  | 'NONE';

export type MarketStatusReason =
  | 'fno_ban_active'
  | 'sebi_trading_restriction'
  | 'sebi_investigation_open'
  | 'gsm_stage_high'
  | 'asm_list'
  | 't2t_segment';

export interface MarketStatusCheckResult {
  readonly passed: boolean;
  readonly reason?: MarketStatusReason;
  readonly detail: string;
  readonly fno_banned: boolean;
  readonly sebi_action_active: boolean;
  readonly surveillance_stage: SurveillanceStage;
}

export interface OvernightGapMetrics {
  readonly gap_frequency_pct: number;
  readonly median_gap_magnitude_pct: number;
  readonly p95_gap_magnitude_pct: number;
  readonly gap_observations: number;
  readonly vix_current: number;
  readonly beta: number;
  readonly expected_overnight_gap_pct: number;
  readonly gap_risk_score: number;
  readonly risk_tier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
}

export interface OvernightGapCheckResult {
  readonly passed: boolean;
  readonly adjusted_qty: number;
  readonly metrics: OvernightGapMetrics;
  readonly reason?: string;
  readonly detail: string;
}

export interface VolatilityMetrics {
  readonly atr_pct: number;
  readonly hv_20: number;
  readonly spike_ratio: number;
}

// ─── Configuration Types ─────────────────────────────────────────────────────
export interface MarketRiskConfig {
  weight_nifty: number;                      // Default 0.35
  weight_banknifty: number;                  // Default 0.25
  weight_regime: number;                     // Default 0.25
  weight_vix: number;                        // Default 0.15

  crash_nifty_dd_threshold: number;          // Default 0.15
  banknifty_divergence_threshold: number;    // Default 0.40
  banknifty_lag_cap: number;                 // Default 0.70

  vix_extreme_threshold: number;             // Default 35.0
  vix_spike_ratio_threshold: number;         // Default 1.40
  vix_spike_cache_invalidation_ratio: number;// Default 1.25

  multiplier_strong_bull: number;            // Default 1.00
  multiplier_bull: number;                   // Default 0.85
  multiplier_neutral: number;                // Default 0.70
  multiplier_caution: number;                // Default 0.50
  multiplier_bear: number;                   // Default 0.30
  multiplier_high_volatility: number;        // Default 0.40

  market_context_refresh_interval_minutes: number;  // Default 15
}

export interface SwingRiskConfig {
  earnings_gap_low_threshold_pct: number;     // Default 3.0
  earnings_gap_medium_threshold_pct: number;  // Default 6.0
  earnings_gap_high_threshold_pct: number;    // Default 10.0
  earnings_gap_min_observations: number;      // Default 3

  gap_history_lookback_days: number;          // Default 252
  gap_significant_threshold_pct: number;      // Default 2.0
  gap_sigma_multiplier: number;               // Default 1.65
  overnight_fraction: number;                 // Default 0.40
  gap_weight_historical: number;              // Default 0.40
  gap_weight_p95: number;                     // Default 0.35
  gap_weight_vix: number;                     // Default 0.25
  gap_medium_size_multiplier: number;         // Default 0.85
  gap_high_size_multiplier: number;           // Default 0.60

  block_on_fno_ban: boolean;                  // Default true
  block_on_sebi_investigation: boolean;       // Default true
  sebi_investigation_multiplier: number;      // Default 0.50
  gsm_block_stage: number;                    // Default 5

  news_impact_medium_multiplier: number;      // Default 0.75
  news_impact_high_multiplier: number;        // Default 0.50
}

export interface ApprovalConfig {
  confidence_weight_stages: number;     // Default 0.40
  confidence_weight_conviction: number; // Default 0.35
  confidence_weight_market: number;     // Default 0.25
  min_confidence_to_approve: number;    // Default 0.30
}

export interface RiskConfig extends MarketRiskConfig, SwingRiskConfig, ApprovalConfig {
  // General validation rules
  max_risk_per_trade_pct: number;       // e.g. 0.01 (1% risk)
  max_capital_per_trade_pct: number;    // e.g. 0.10 (10% allocation limit)
  max_open_trades: number;              // e.g. 10 positions
  max_stock_pct: number;                // e.g. 0.15 (15% max per stock)
  max_sector_pct: number;               // e.g. 0.30 (30% max per sector)
  max_net_long_pct: number;             // e.g. 1.00 (100% net long cap)
  max_portfolio_var_pct: number;        // e.g. 0.04 (4% max VaR)

  max_daily_drawdown_pct: number;       // e.g. 0.02 (2% daily DD limit)
  max_weekly_drawdown_pct: number;      // e.g. 0.05 (5% weekly DD limit)
  max_monthly_drawdown_pct: number;     // e.g. 0.08 (8% monthly DD limit)

  min_tradeable_qty: number;            // e.g. 1 share
  block_on_earnings: boolean;           // Default false
}
