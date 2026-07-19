/**
 * packages/phase7-broker/src/types/domain.ts
 * Artha AI — Phase 7 Execution Domain Contracts
 */

export interface TradeIntent {
  readonly intent_id: string;            // Phase 7-generated UUID
  readonly signal_id: string;            // Join key to SignalEvent + TradeApprovalResult
  readonly account_id: string;           // E.g., 'DEFAULT_ACCOUNT'

  readonly symbol_id: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly entry_price_hint: number;
  readonly stop_loss: number | null;
  readonly take_profit: number | null;

  readonly decision: 'APPROVED' | 'REDUCED_SIZE';
  readonly approved_qty: number;
  readonly confidence: number;
  readonly conviction_score: number;
  readonly risk_budget_multiplier: number;
  readonly market_state: string;
  readonly sizing_method: string;

  readonly evaluated_at: Date;
  readonly received_at: Date;
}

export interface OrderRequest {
  readonly order_request_id: string;     // Physical attempt ID
  readonly intent_id: string;            // FK to TradeIntent
  readonly idempotency_key: string;      // Stable across retries of logical order

  readonly symbol_id: string;
  readonly broker_direction: 'BUY' | 'SELL';
  readonly order_type: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  readonly qty: number;
  readonly price: number | null;
  readonly trigger_price: number | null;
  readonly product_type: 'CNC' | 'MIS' | 'NRML';
  readonly validity: 'DAY' | 'IOC' | 'GTD';

  readonly created_at: Date;
  readonly attempt: number;              // Starts at 1
}

export type ExecutionLifecycleStatus =
  | 'CREATED'
  | 'SENT_TO_BROKER'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'CANCELLED';

export interface SlippageInfo {
  readonly expected_price: number;
  readonly actual_price: number;
  readonly slippage_abs: number;         // actual - expected, signed
  readonly slippage_bps: number;         // signed basis points
  readonly direction: 'FAVORABLE' | 'ADVERSE' | 'NEUTRAL';
}

export interface ExecutionEvent {
  readonly event_id: string;
  readonly occurred_at: Date;

  // Traceability chain
  readonly signal_id: string;
  readonly trade_intent_id: string;
  readonly order_id: string;             // logical order (idempotency key scope)
  readonly order_request_id: string;     // physical attempt ID

  readonly account_id: string;
  readonly symbol_id: string;
  readonly direction: 'LONG' | 'SHORT';

  readonly status: ExecutionLifecycleStatus;

  readonly fill_price: number | null;
  readonly fill_quantity: number | null;
  readonly slippage: number | null;      // signed basis points

  readonly execution_latency_ms: number; // occurred_at - TradeIntent.received_at
  readonly broker_timestamp: Date | null;
}

export interface ExecutionResult {
  readonly order_id: string;
  readonly trade_intent_id: string;
  readonly signal_id: string;
  readonly account_id: string;
  readonly symbol_id: string;
  readonly direction: 'LONG' | 'SHORT';

  readonly final_status: 'FILLED' | 'REJECTED' | 'CANCELLED';

  readonly requested_qty: number;
  readonly total_filled_qty: number;
  readonly fill_count: number;

  readonly avg_fill_price: number | null;
  readonly realized_slippage_bps: number | null;
  readonly total_commission: number;

  readonly total_attempts: number;
  readonly opened_at: Date;
  readonly closed_at: Date;
  readonly total_execution_latency_ms: number;

  readonly reject_reason: string | null;
  readonly cancel_reason: string | null;
}

export interface FillEvent {
  readonly fill_id: string;
  readonly order_request_id: string;
  readonly broker_fill_id: string;
  readonly fill_qty: number;
  readonly fill_price: number;
  readonly commission: number;
  readonly is_partial: boolean;
  readonly slippage: SlippageInfo;
  readonly exchange_ts: Date | null;
  readonly received_ts: Date;
}

export type OrderStatus =
  | 'PENDING_SUBMISSION'
  | 'SUBMITTED'
  | 'ACKED'
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'RETRY_PENDING'
  | 'RETRY_EXHAUSTED'
  | 'ACK_AMBIGUOUS';

export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_SUBMISSION: ['SUBMITTED', 'REJECTED'],
  SUBMITTED:          ['ACKED', 'ACK_AMBIGUOUS', 'REJECTED'],
  ACKED:              ['OPEN', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED'],
  OPEN:               ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED'],
  PARTIALLY_FILLED:   ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED'],
  FILLED:             [],
  REJECTED:           ['RETRY_PENDING'],
  CANCELLED:          [],
  EXPIRED:            [],
  RETRY_PENDING:      ['SUBMITTED', 'RETRY_EXHAUSTED'],
  RETRY_EXHAUSTED:    [],
  ACK_AMBIGUOUS:      ['ACKED', 'REJECTED', 'RETRY_PENDING'],
} as const;

export interface BrokerResponse {
  readonly response_id: string;
  readonly order_request_id: string;
  readonly broker_order_id: string | null;
  readonly raw_status: string;
  readonly normalized_status: OrderStatus;
  readonly reject_reason: string | null;
  readonly retryable: boolean;
  readonly latency_ms: number;
  readonly received_at: Date;
  readonly raw_payload: Record<string, unknown>;
}

export interface BracketConfig {
  readonly target_multiple_atr: number;  // e.g., 2.0 (2x ATR take-profit)
  readonly stop_multiple_atr: number;    // e.g., 1.5 (1.5x ATR initial stop)
}

export interface TrailingStopState {
  readonly hwm_price: number;
  readonly current_stop_price: number;
  readonly K_multiplier: number;
}
