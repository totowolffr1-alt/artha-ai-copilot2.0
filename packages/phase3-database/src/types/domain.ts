/**
 * packages/phase3-database/src/types/domain.ts
 * Artha AI — Phase 3
 *
 * TypeScript row-level interfaces for every Phase 3 database table.
 * Rules:
 *   - Each interface mirrors the exact column set of its table.
 *   - All UUIDs are typed as `string` (pg driver returns strings).
 *   - All numeric DB columns are typed as `number` (repos parse pg's string output).
 *   - All JSONB columns are typed as `Record<string, unknown>` or specific types.
 *   - All timestamps are `Date` objects (pg driver auto-parses timestamptz).
 *   - Nullable columns are `T | null`.
 */

// ─── Enum String Literal Unions ───────────────────────────────────────────────
// Match the PostgreSQL enum values exactly.

export type ExchangeType = 'NSE' | 'BSE' | 'NFO' | 'BFO' | 'MCX' | 'CDS';

export type AssetTypeEnum =
  | 'equity'
  | 'index'
  | 'futures'
  | 'options'
  | 'commodity'
  | 'currency'
  | 'etf';

export type TimeframeEnum = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1w';

export type CandleStatus = 'partial' | 'closed';

export type SignalStatus = 'pending' | 'acted' | 'expired' | 'rejected' | 'cancelled';

export type TradeStatus = 'pending' | 'open' | 'partial' | 'closed' | 'cancelled' | 'rejected';

export type OrderStatus =
  | 'pending'
  | 'placed'
  | 'open'
  | 'partial'
  | 'complete'
  | 'cancelled'
  | 'rejected';

export type PositionStatus = 'open' | 'partial' | 'closed';

export type TradingMode = 'live' | 'paper' | 'backtest';

export type StrategyRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'overfit';

export type CloseReason =
  | 'sl_triggered'
  | 'target_hit'
  | 'timeout_exit'
  | 'forced_exit'
  | 'fold_boundary_exit';

export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';

export type OrderValidity = 'DAY' | 'IOC' | 'GTD';

export type OrderDirection = 'BUY' | 'SELL';

export type TradeDirection = 'LONG' | 'SHORT';

export type SyncType = 'instrument_master' | 'holiday_calendar';

export type SyncStatus = 'running' | 'completed' | 'failed';

export type SubscriptionMode = 1 | 2 | 3;  // SmartAPI: 1=LTP, 2=QUOTE, 3=SNAP_QUOTE

export type PeriodType = 'daily' | 'weekly' | 'monthly' | 'ytd' | 'all_time' | 'custom';

export type EquityGranularity = '1m' | '5m' | '1h' | '1d';

// ─── Market Data Tables ───────────────────────────────────────────────────────

export interface SymbolRow {
  readonly symbol_id:        string;
  readonly ticker:           string;
  readonly name:             string | null;
  readonly exchange:         ExchangeType;
  readonly asset_type:       AssetTypeEnum;
  readonly lot_size:         number;
  readonly tick_size:        number;
  readonly isin:             string | null;
  readonly broker_token:     string | null;
  readonly broker_exch_type: number | null;
  readonly is_active:        boolean;
  readonly created_at:       Date;
  readonly updated_at:       Date;
}

export interface TickRow {
  readonly tick_id:           string;
  readonly symbol_id:         string;
  readonly exchange_ts:       Date;
  readonly received_ts:       Date;
  readonly price:             number;
  readonly volume:            number;
  readonly bid:               number | null;
  readonly ask:               number | null;
  readonly open_price:        number | null;
  readonly high_price:        number | null;
  readonly low_price:         number | null;
  readonly avg_traded_price:  number | null;
  readonly total_buy_qty:     number | null;
  readonly total_sell_qty:    number | null;
  readonly session_id:        string;
}

export interface CandleRow {
  readonly candle_id:    string;
  readonly symbol_id:    string;
  readonly bucket_ts:    Date;
  readonly timeframe:    TimeframeEnum;
  readonly open:         number;
  readonly high:         number;
  readonly low:          number;
  readonly close:        number;
  readonly volume:       number;
  readonly vwap:         number | null;
  readonly delta_volume: number | null;
  readonly tick_count:   number;
  readonly state:        CandleStatus;
  readonly is_partial:   boolean;
}

export interface OptionChainSnapshotRow {
  readonly snapshot_id:      string;
  readonly underlying_id:    string;
  readonly captured_at:      Date;
  readonly expiry:           Date;      // pg returns 'date' columns as Date
  readonly underlying_price: number;
  readonly atm_iv:           number | null;
  readonly chain_pcr:        number | null;
}

export interface OptionStrikeRow {
  readonly strike_id:    string;
  readonly snapshot_id:  string;
  readonly symbol_id:    string;
  readonly strike_price: number;
  readonly option_type:  'CE' | 'PE';
  readonly ltp:          number | null;
  readonly iv:           number | null;
  readonly delta:        number | null;
  readonly gamma:        number | null;
  readonly theta:        number | null;
  readonly vega:         number | null;
  readonly oi:           number | null;
  readonly oi_change:    number | null;
  readonly volume:       number | null;
  readonly bid:          number | null;
  readonly ask:          number | null;
  readonly bid_qty:      number | null;
  readonly ask_qty:      number | null;
  readonly strike_pcr:   number | null;
}

// ─── Session State Tables ─────────────────────────────────────────────────────

export interface AccountRow {
  readonly account_id:       string;
  readonly broker_client_id: string;
  readonly broker_name:      string;
  readonly mode:             TradingMode;
  readonly initial_capital:  number;
  readonly cash_balance:     number;
  readonly margin_used:      number;
  readonly is_active:        boolean;
  readonly created_at:       Date;
  readonly updated_at:       Date;
}

export interface BrokerSessionRow {
  readonly session_id:    string;
  readonly account_id:    string;
  readonly access_token:  string;   // stored encrypted, decrypted by repo
  readonly refresh_token: string | null;
  readonly feed_token:    string | null;
  readonly expires_at:    Date;
  readonly connected_at:  Date;
}

export interface ActiveSubscriptionRow {
  readonly subscription_id: string;
  readonly account_id:      string;
  readonly symbol_id:       string;
  readonly mode:            SubscriptionMode;
  readonly subscribed_at:   Date;
}

// ─── Strategy Runs ────────────────────────────────────────────────────────────

/** JSON-serialisable parameter snapshot stored in strategy_runs.parameter_snapshot */
export interface ParameterSnapshot {
  strategyId:      string;
  strategyVersion: number;
  parameters:      Record<string, unknown>;
  timeframe:       TimeframeEnum;
  symbols:         string[];
}

export interface StrategyRunRow {
  readonly strategy_run_id:   string;
  readonly strategy_id:       string;
  readonly strategy_version:  number;
  readonly mode:              TradingMode;
  readonly status:            StrategyRunStatus;
  readonly parameter_snapshot: ParameterSnapshot;
  readonly summary_metrics:   Record<string, unknown> | null;
  readonly reports_jsonb:     Record<string, unknown> | null;
  readonly walk_forward_fold: number | null;
  readonly started_at:        Date | null;
  readonly completed_at:      Date | null;
  readonly error_message:     string | null;
  readonly created_at:        Date;
}

// ─── Trading Pipeline ─────────────────────────────────────────────────────────

/** Feature vector snapshot at signal time. Keys are indicator names. */
export type FeatureVector = Record<string, number | boolean | string | null>;

export interface SignalRow {
  readonly signal_id:        string;
  readonly symbol_id:        string;
  readonly strategy_run_id:  string | null;
  readonly signal_type:      string;
  readonly direction:        TradeDirection;
  readonly strength:         number;
  readonly entry_price_hint: number | null;
  readonly stop_loss:        number | null;
  readonly take_profit:      number | null;
  readonly kelly_fraction:   number | null;
  readonly regime:           string | null;
  readonly features:         FeatureVector;
  readonly status:           SignalStatus;
  readonly fired_at:         Date;
  readonly expires_at:       Date | null;
  readonly acted_at:         Date | null;
  readonly acted_by_trade:   string | null;
}

export interface TradeRow {
  readonly trade_id:         string;
  readonly signal_id:        string | null;
  readonly symbol_id:        string;
  readonly account_id:       string;
  readonly mode:             TradingMode;
  readonly direction:        TradeDirection;
  readonly qty:              number;
  readonly filled_qty:       number;
  readonly avg_entry_price:  number | null;
  readonly avg_exit_price:   number | null;
  readonly realised_pnl:     number | null;
  readonly commission:       number;
  readonly slippage:         number | null;
  readonly close_reason:     CloseReason | null;
  readonly status:           TradeStatus;
  readonly opened_at:        Date | null;
  readonly closed_at:        Date | null;
  readonly updated_at:       Date;
}

export interface OrderRow {
  readonly order_id:        string;
  readonly trade_id:        string;
  readonly symbol_id:       string;
  readonly broker_order_id: string | null;
  readonly order_type:      OrderType;
  readonly direction:       OrderDirection;
  readonly qty:             number;
  readonly price:           number | null;
  readonly trigger_price:   number | null;
  readonly product_type:    string;
  readonly validity:        OrderValidity;
  readonly status:          OrderStatus;
  readonly reject_reason:   string | null;
  readonly placed_at:       Date | null;
  readonly updated_at:      Date;
}

export interface ExecutionRow {
  readonly execution_id:  string;
  readonly order_id:      string;
  readonly trade_id:      string;
  readonly broker_fill_id: string | null;
  readonly fill_qty:      number;
  readonly fill_price:    number;
  readonly commission:    number;
  readonly exchange_seg:  string | null;
  readonly exchange_ts:   Date | null;
  readonly received_ts:   Date;
}

// ─── Portfolio Tables ─────────────────────────────────────────────────────────

export interface PortfolioRow {
  readonly portfolio_id:      string;
  readonly account_id:        string;
  readonly name:              string;
  readonly mode:              TradingMode;
  readonly allocated_capital: number;
  readonly cash_available:    number;
  readonly unrealised_pnl:    number;
  readonly realised_pnl:      number;
  readonly total_value:       number;
  readonly drawdown_pct:      number;
  readonly peak_value:        number;
  readonly snapshot_at:       Date;
  readonly created_at:        Date;
}

export interface PositionRow {
  readonly position_id:    string;
  readonly portfolio_id:   string;
  readonly symbol_id:      string;
  readonly trade_id:       string;
  readonly direction:      TradeDirection;
  readonly qty:            number;
  readonly avg_cost:       number;
  readonly ltp:            number | null;
  readonly unrealised_pnl: number;
  readonly realised_pnl:   number;
  readonly mtm_value:      number;
  readonly margin_blocked: number;
  readonly status:         PositionStatus;
  readonly opened_at:      Date;
  readonly closed_at:      Date | null;
  readonly updated_at:     Date;
}

export interface EquityCurveRow {
  readonly point_id:       string;
  readonly portfolio_id:   string;
  readonly recorded_at:    Date;
  readonly equity:         number;
  readonly cash:           number;
  readonly unrealised_pnl: number;
  readonly drawdown_pct:   number;
  readonly drawdown_abs:   number;
  readonly open_positions: number;
  readonly granularity:    EquityGranularity;
}

export interface PerformanceMetricsRow {
  readonly metric_id:        string;
  readonly portfolio_id:     string;
  readonly strategy_run_id:  string | null;
  readonly period_start:     Date;
  readonly period_end:       Date;
  readonly period_type:      PeriodType;
  readonly total_return_pct: number | null;
  readonly cagr_pct:         number | null;
  readonly sharpe_ratio:     number | null;
  readonly sortino_ratio:    number | null;
  readonly calmar_ratio:     number | null;
  readonly max_drawdown_pct: number;
  readonly max_drawdown_abs: number;
  readonly win_rate:         number | null;
  readonly profit_factor:    number | null;
  readonly avg_win:          number | null;
  readonly avg_loss:         number | null;
  readonly expectancy:       number | null;
  readonly avg_rrr:          number | null;
  readonly total_trades:     number;
  readonly winning_trades:   number;
  readonly losing_trades:    number;
  readonly commission_total: number;
  readonly slippage_total:   number;
  readonly computed_at:      Date;
}

// ─── Learning Engine Tables ───────────────────────────────────────────────────

export interface LearningRecordRow {
  readonly record_id:         string;
  readonly trade_id:          string;
  readonly signal_id:         string | null;
  readonly symbol_id:         string;
  readonly regime:            string;
  readonly features_at_entry: FeatureVector;
  readonly features_at_exit:  FeatureVector | null;
  readonly predicted_return:  number | null;
  readonly actual_return:     number;
  readonly prediction_error:  number | null;
  readonly entry_price:       number;
  readonly exit_price:        number;
  readonly realised_pnl:      number;
  readonly mae:               number;
  readonly mfe:               number;
  readonly holding_bars:      number;
  readonly was_winner:        boolean;
  readonly kelly_used:        number | null;
  readonly kelly_optimal:     number | null;
  readonly trade_opened_at:   Date;
  readonly trade_closed_at:   Date;
  readonly recorded_at:       Date;
}

export interface StrategyPerformanceRow {
  readonly perf_id:             string;
  readonly strategy_run_id:     string;
  readonly symbol_id:           string | null;
  readonly regime:              string;
  readonly period_start:        Date;
  readonly period_end:          Date;
  readonly period_type:         PeriodType;
  readonly total_signals:       number;
  readonly acted_signals:       number;
  readonly winning_trades:      number;
  readonly losing_trades:       number;
  readonly win_rate:            number;
  readonly avg_return_pct:      number | null;
  readonly avg_mae:             number | null;
  readonly avg_mfe:             number | null;
  readonly avg_holding_bars:    number | null;
  readonly sharpe_ratio:        number | null;
  readonly profit_factor:       number | null;
  readonly kelly_accuracy:      number | null;
  readonly avg_prediction_error: number | null;
  readonly regime_fitness:      number | null;
  readonly computed_at:         Date;
}

export interface IndicatorPerformanceRow {
  readonly indicator_perf_id:   string;
  readonly strategy_run_id:     string;
  readonly indicator_name:      string;
  readonly indicator_params:    string;
  readonly regime:              string;
  readonly symbol_class:        string;
  readonly period_start:        Date;
  readonly period_end:          Date;
  readonly predictive_accuracy: number | null;
  readonly signal_contribution: number | null;
  readonly avg_lead_bars:       number | null;
  readonly false_positive_rate: number | null;
  readonly false_negative_rate: number | null;
  readonly information_ratio:   number | null;
  readonly sample_count:        number;
  readonly computed_at:         Date;
}

/** Ranked indicator entry stored in regime_performance.indicator_rankings JSONB */
export interface IndicatorRanking {
  indicator_name:   string;
  params:           string;
  information_ratio: number;
}

export interface RegimePerformanceRow {
  readonly regime_perf_id:     string;
  readonly symbol_id:          string | null;
  readonly regime:             string;
  readonly timeframe:          string;
  readonly period_start:       Date;
  readonly period_end:         Date;
  readonly occurrence_count:   number;
  readonly avg_duration_bars:  number | null;
  readonly avg_return_pct:     number | null;
  readonly win_rate:           number | null;
  readonly best_strategy:      string | null;
  readonly worst_strategy:     string | null;
  readonly avg_volatility:     number | null;
  readonly avg_volume_ratio:   number | null;
  readonly indicator_rankings: IndicatorRanking[];
  readonly computed_at:        Date;
}

// ─── Infrastructure Tables ────────────────────────────────────────────────────

export interface RiskLimitRow {
  readonly limit_id:   string;
  readonly account_id: string;
  readonly limit_type: string;
  readonly limit_value: number;
  readonly is_active:  boolean;
  readonly updated_at: Date;
}

export interface KeyVersionRow {
  readonly key_id:       string;
  readonly activated_at: Date;
  readonly deprecated_at: Date | null;
}

export interface AuditLogRow {
  readonly audit_id:    string;
  readonly table_name:  string;
  readonly operation:   'INSERT' | 'UPDATE';
  readonly row_id:      string;
  readonly changed_by:  string | null;
  readonly old_values:  Record<string, unknown> | null;
  readonly new_values:  Record<string, unknown>;
  readonly chain_hash:  string;
  readonly key_id:      string;
  readonly recorded_at: Date;
}

export interface SyncLogRow {
  readonly sync_id:          string;
  readonly sync_type:        SyncType;
  readonly started_at:       Date;
  readonly completed_at:     Date | null;
  readonly rows_upserted:    number | null;
  readonly rows_deactivated: number | null;
  readonly status:           SyncStatus;
  readonly error:            string | null;
}
