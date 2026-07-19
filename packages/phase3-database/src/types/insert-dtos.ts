/**
 * packages/phase3-database/src/types/insert-dtos.ts
 * Artha AI — Phase 3
 *
 * Insert DTOs — the fields required when INSERTing a new row.
 * DB-generated fields (uuid PKs, created_at DEFAULT now()) are OMITTED.
 * Repos accept these and produce the full Row type after insert.
 */

import type {
  ExchangeType, AssetTypeEnum, TimeframeEnum, CandleStatus,
  SignalStatus, TradeStatus, OrderStatus, PositionStatus, TradingMode,
  StrategyRunStatus, TradeDirection, OrderDirection, OrderType, OrderValidity,
  CloseReason, FeatureVector, ParameterSnapshot, EquityGranularity,
  PeriodType, SyncType, SubscriptionMode, IndicatorRanking,
} from './domain';

// ─── Market Data ──────────────────────────────────────────────────────────────

export interface InsertSymbol {
  ticker:           string;
  name?:            string;
  exchange:         ExchangeType;
  asset_type:       AssetTypeEnum;
  lot_size?:        number;
  tick_size?:       number;
  isin?:            string;
  broker_token?:    string;
  broker_exch_type?: number;
  is_active?:       boolean;
}

/** Used for batch COPY protocol inserts — every field is required */
export interface InsertTick {
  symbol_id:          string;
  exchange_ts:        Date;
  received_ts?:       Date;
  price:              number;
  volume:             number;
  bid?:               number;
  ask?:               number;
  open_price?:        number;
  high_price?:        number;
  low_price?:         number;
  avg_traded_price?:  number;
  total_buy_qty?:     number;
  total_sell_qty?:    number;
  session_id:         string;
}

export interface InsertCandle {
  symbol_id:    string;
  bucket_ts:    Date;
  timeframe:    TimeframeEnum;
  open:         number;
  high:         number;
  low:          number;
  close:        number;
  volume:       number;
  vwap?:        number;
  delta_volume?: number;
  tick_count?:  number;
  state?:       CandleStatus;
  is_partial?:  boolean;
}

export interface InsertOptionChainSnapshot {
  underlying_id:    string;
  captured_at:      Date;
  expiry:           Date;
  underlying_price: number;
  atm_iv?:          number;
  chain_pcr?:       number;
}

export interface InsertOptionStrike {
  snapshot_id:  string;
  symbol_id:    string;
  strike_price: number;
  option_type:  'CE' | 'PE';
  ltp?:         number;
  iv?:          number;
  delta?:       number;
  gamma?:       number;
  theta?:       number;
  vega?:        number;
  oi?:          number;
  oi_change?:   number;
  volume?:      number;
  bid?:         number;
  ask?:         number;
  bid_qty?:     number;
  ask_qty?:     number;
  strike_pcr?:  number;
}

// ─── Accounts / Sessions ──────────────────────────────────────────────────────

export interface InsertAccount {
  broker_client_id: string;
  broker_name?:     string;
  mode:             TradingMode;
  initial_capital:  number;
  cash_balance?:    number;
}

export interface InsertBrokerSession {
  account_id:    string;
  access_token:  string;    // must be pre-encrypted by app layer (SEC1)
  refresh_token?: string;
  feed_token?:   string;
  expires_at:    Date;
}

export interface InsertActiveSubscription {
  account_id: string;
  symbol_id:  string;
  mode:       SubscriptionMode;
}

// ─── Strategy Runs ────────────────────────────────────────────────────────────

export interface InsertStrategyRun {
  strategy_id:        string;
  strategy_version?:  number;
  mode:               TradingMode;
  status?:            StrategyRunStatus;
  parameter_snapshot: ParameterSnapshot;
  walk_forward_fold?: number;
}

// ─── Trading Pipeline ─────────────────────────────────────────────────────────

export interface InsertSignal {
  symbol_id:        string;
  strategy_run_id?: string;
  signal_type:      string;
  direction:        TradeDirection;
  strength:         number;
  entry_price_hint?: number;
  stop_loss?:       number;
  take_profit?:     number;
  kelly_fraction?:  number;
  regime?:          string;
  features?:        FeatureVector;
  status?:          SignalStatus;
  expires_at?:      Date;
}

export interface InsertTrade {
  signal_id?:   string;
  symbol_id:    string;
  account_id:   string;
  mode:         TradingMode;
  direction:    TradeDirection;
  qty:          number;
  status?:      TradeStatus;
}

export interface InsertOrder {
  trade_id:       string;
  symbol_id:      string;
  order_type:     OrderType;
  direction:      OrderDirection;
  qty:            number;
  price?:         number;
  trigger_price?: number;
  product_type:   string;
  validity?:      OrderValidity;
  status?:        OrderStatus;
}

/** Append-only — no update after insert */
export interface InsertExecution {
  order_id:       string;
  trade_id:       string;
  broker_fill_id?: string;
  fill_qty:       number;
  fill_price:     number;
  commission?:    number;
  exchange_seg?:  string;
  exchange_ts?:   Date;
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

export interface InsertPortfolio {
  account_id:        string;
  name:              string;
  mode:              TradingMode;
  allocated_capital: number;
  cash_available?:   number;
}

export interface InsertPosition {
  portfolio_id:   string;
  symbol_id:      string;
  trade_id:       string;
  direction:      TradeDirection;
  qty:            number;
  avg_cost:       number;
  opened_at:      Date;
  margin_blocked?: number;
}

export interface InsertEquityCurvePoint {
  portfolio_id:   string;
  recorded_at:    Date;
  equity:         number;
  cash:           number;
  unrealised_pnl: number;
  drawdown_pct:   number;
  drawdown_abs:   number;
  open_positions?: number;
  granularity:    EquityGranularity;
}

export interface UpsertPerformanceMetrics {
  portfolio_id:      string;
  strategy_run_id?:  string;
  period_start:      Date;
  period_end:        Date;
  period_type:       PeriodType;
  total_return_pct?: number;
  cagr_pct?:         number;
  sharpe_ratio?:     number;
  sortino_ratio?:    number;
  calmar_ratio?:     number;
  max_drawdown_pct?: number;
  max_drawdown_abs?: number;
  win_rate?:         number;
  profit_factor?:    number;
  avg_win?:          number;
  avg_loss?:         number;
  expectancy?:       number;
  avg_rrr?:          number;
  total_trades?:     number;
  winning_trades?:   number;
  losing_trades?:    number;
  commission_total?: number;
  slippage_total?:   number;
}

// ─── Learning Engine ──────────────────────────────────────────────────────────

export interface InsertLearningRecord {
  trade_id:          string;
  signal_id?:        string;
  symbol_id:         string;
  regime:            string;
  features_at_entry: FeatureVector;
  features_at_exit?: FeatureVector;
  predicted_return?: number;
  actual_return:     number;
  prediction_error?: number;
  entry_price:       number;
  exit_price:        number;
  realised_pnl:      number;
  mae:               number;
  mfe:               number;
  holding_bars:      number;
  was_winner:        boolean;
  kelly_used?:       number;
  kelly_optimal?:    number;
  trade_opened_at:   Date;
  trade_closed_at:   Date;
}

// ─── Infrastructure ───────────────────────────────────────────────────────────

export interface InsertRiskLimit {
  account_id:  string;
  limit_type:  string;
  limit_value: number;
  is_active?:  boolean;
}

export interface InsertSyncLog {
  sync_type: SyncType;
}

export interface InsertAuditLog {
  table_name: string;
  operation:  'INSERT' | 'UPDATE';
  row_id:     string;
  changed_by?: string;
  old_values?: Record<string, unknown>;
  new_values: Record<string, unknown>;
  chain_hash: string;
  key_id:     string;
}
