# Artha AI — Phase 7: Execution Domain Model v1

Domain objects only. No DB schema, no implementation logic, no learning/AI (Phase 9 doesn't exist). Pure state-machine contracts for the execution layer.

**Boundary in:** Phase 6 `TradeApprovalResult` (decision-only — no symbol/direction/price levels) + Phase 5 `SignalEvent` (read-only, joined by `signal_id`).
**Boundary out:** broker order lifecycle, fills, retries — all modeled below.

---

## 1. TradeIntent (input from Phase 6)

`TradeApprovalResult` alone is insufficient — it carries no `symbol_id`, `direction`, `stop_loss`, `take_profit`, or `entry_price_hint`. Phase 7 must fuse it with the originating `SignalEvent` (via `signal_id`) before any order can be built. This fusion is Phase 7's job — not a Phase 5/6 redesign.

`TradeIntent` only ever exists for `APPROVED` / `REDUCED_SIZE`. `REJECTED` terminates at the Phase 6 boundary — no intent object is created for it.

```typescript
export interface TradeIntent {
  readonly intent_id: string;            // Phase 7-generated UUID, distinct from signal_id
  readonly signal_id: string;            // join key: SignalEvent + TradeApprovalResult
  readonly account_id: string;           // UNRESOLVED UPSTREAM — see note

  // Sourced from SignalEvent (read-only)
  readonly symbol_id: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly entry_price_hint: number;     // informational only — never used for fill comparison directly
  readonly stop_loss: number | null;
  readonly take_profit: number | null;

  // Sourced from TradeApprovalResult
  readonly decision: 'APPROVED' | 'REDUCED_SIZE';   // narrowed — REJECTED never reaches here
  readonly approved_qty: number;         // = TradeApprovalResult.suggestedSize
  readonly confidence: number;           // [0,1]
  readonly conviction_score: number;
  readonly risk_budget_multiplier: number;
  readonly market_state: string;         // mirrors Phase 6 MarketState — still untyped upstream
  readonly sizing_method: string;

  readonly evaluated_at: Date;           // when Phase 6 produced the verdict
  readonly received_at: Date;            // when Phase 7 received it
}
```

> `account_id` — no resolution mechanism exists upstream. Neither `SignalEvent` nor `TradeApprovalResult` carries it. Field is kept here because execution cannot proceed without it; the resolver itself is out of scope for this document.

---

## 2. OrderRequest

Broker-facing order built from one `TradeIntent`. Models the entry order only — bracket/child SL/TP orders are future work, not covered here.

`idempotency_key` is mandatory and stable across retries of the *same* logical order — never regenerated on retry.

```typescript
export interface OrderRequest {
  readonly order_request_id: string;     // Phase 7-internal UUID, pre-broker
  readonly intent_id: string;            // FK to TradeIntent
  readonly idempotency_key: string;      // stable across retry attempts of this order

  readonly symbol_id: string;
  readonly broker_direction: 'BUY' | 'SELL';   // LONG→BUY, SHORT→SELL (entry only)
  readonly order_type: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  readonly qty: number;                  // > 0
  readonly price: number | null;         // null for MARKET
  readonly trigger_price: number | null; // required for SL, SL-M
  readonly product_type: 'CNC' | 'MIS' | 'NRML';
  readonly validity: 'DAY' | 'IOC' | 'GTD';

  readonly created_at: Date;
  readonly attempt: number;              // 1 on first submission, increments on retry
}
```

---

## 3. ExecutionEvent

Append-only event stream per `OrderRequest`. Discriminated union — every transition Phase 7 can observe or produce is represented exactly once. Each event is independently dispatchable and replay-safe; none implies another.

```typescript
export type ExecutionEvent =
  | OrderSubmittedEvent
  | OrderAckedEvent
  | OrderPartiallyFilledEvent
  | OrderFilledEvent
  | OrderRejectedEvent
  | OrderCancelledEvent
  | OrderExpiredEvent
  | OrderRetryScheduledEvent
  | OrderRetryExhaustedEvent
  | OrderAckAmbiguousEvent;        // network/timeout — broker state unknown, NOT a rejection

interface BaseExecutionEvent {
  readonly event_id: string;
  readonly order_request_id: string;
  readonly occurred_at: Date;
}

export interface OrderSubmittedEvent extends BaseExecutionEvent {
  readonly type: 'ORDER_SUBMITTED';
}

export interface OrderAckedEvent extends BaseExecutionEvent {
  readonly type: 'ORDER_ACKED';
  readonly broker_order_id: string;
}

export interface OrderPartiallyFilledEvent extends BaseExecutionEvent {
  readonly type: 'ORDER_PARTIALLY_FILLED';
  readonly fill: FillEvent;
  readonly cumulative_filled_qty: number;
  readonly remaining_qty: number;        // > 0 — order stays OPEN
}

export interface OrderFilledEvent extends BaseExecutionEvent {
  readonly type: 'ORDER_FILLED';
  readonly fill: FillEvent;              // final fill — remaining_qty = 0
  readonly cumulative_filled_qty: number;
}

export interface OrderRejectedEvent extends BaseExecutionEvent {
  readonly type: 'ORDER_REJECTED';
  readonly reject_source: 'BROKER' | 'PRE_SUBMISSION_VALIDATION';
  readonly reject_reason: string;        // verbatim if BROKER-sourced
  readonly retryable: boolean;
}

export interface OrderCancelledEvent extends BaseExecutionEvent {
  readonly type: 'ORDER_CANCELLED';
  readonly cancelled_by: 'SYSTEM' | 'OPERATOR' | 'BROKER';
  readonly reason: string;
}

export interface OrderExpiredEvent extends BaseExecutionEvent {
  readonly type: 'ORDER_EXPIRED';
  readonly unfilled_qty: number;         // qty that never got a fill before validity lapsed
}

export interface OrderRetryScheduledEvent extends BaseExecutionEvent {
  readonly type: 'ORDER_RETRY_SCHEDULED';
  readonly retry: RetryState;
}

export interface OrderRetryExhaustedEvent extends BaseExecutionEvent {
  readonly type: 'ORDER_RETRY_EXHAUSTED';
  readonly retry: RetryState;
  readonly final_status: 'REJECTED' | 'UNKNOWN';   // UNKNOWN = ambiguous ack never resolved
}

export interface OrderAckAmbiguousEvent extends BaseExecutionEvent {
  readonly type: 'ORDER_ACK_AMBIGUOUS';
  readonly cause: 'NETWORK_TIMEOUT' | 'BROKER_5XX' | 'NO_RESPONSE';
  readonly action_required: 'RECONCILE_BEFORE_RETRY';   // never blind-retry on ambiguity
}

/**
 * RetryState — explicit retry contract, shared by OrderRequest.attempt
 * and the two retry events above.
 */
export interface RetryState {
  readonly attempt: number;
  readonly max_attempts: number;
  readonly backoff_ms: number;
  readonly retry_reason: 'NETWORK_TIMEOUT' | 'BROKER_5XX' | 'RATE_LIMITED' | 'ACK_AMBIGUOUS';
  readonly next_retry_at: Date | null;   // null once exhausted
  readonly last_error: string | null;
}
```

---

## 4. FillEvent

One execution fill, full or partial. Append-only.

```typescript
export interface FillEvent {
  readonly fill_id: string;
  readonly order_request_id: string;
  readonly broker_fill_id: string;       // dedup key from broker
  readonly fill_qty: number;             // > 0
  readonly fill_price: number;           // > 0, actual execution price
  readonly commission: number;           // >= 0
  readonly is_partial: boolean;          // true if remaining_qty > 0 after this fill
  readonly slippage: SlippageInfo;
  readonly exchange_ts: Date | null;     // exchange-confirmed, may lag
  readonly received_ts: Date;            // adapter receipt time
}

/**
 * SlippageInfo — deterministic, signed. No probabilistic modeling.
 * expected_price always comes from TradeIntent.entry_price_hint —
 * never recomputed, never adjusted post-hoc.
 */
export interface SlippageInfo {
  readonly expected_price: number;
  readonly actual_price: number;
  readonly slippage_abs: number;         // actual - expected, signed, rupees
  readonly slippage_bps: number;         // signed, basis points
  readonly direction: 'FAVORABLE' | 'ADVERSE' | 'NEUTRAL';
}
```

---

## 5. OrderStatus

Canonical state machine. Every `ExecutionEvent` maps to exactly one resulting status. Transition table is declarative and exhaustive — a status reached outside it is a system bug, not a market event.

```typescript
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
  | 'ACK_AMBIGUOUS';        // terminal-pending — needs reconciliation, not an auto-retry trigger

export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_SUBMISSION: ['SUBMITTED', 'REJECTED'],
  SUBMITTED:          ['ACKED', 'ACK_AMBIGUOUS', 'REJECTED'],
  ACKED:              ['OPEN', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED'],
  OPEN:               ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED'],
  PARTIALLY_FILLED:   ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED'],
  FILLED:             [],                                       // terminal
  REJECTED:           ['RETRY_PENDING'],
  CANCELLED:          [],                                       // terminal
  EXPIRED:            [],                                       // terminal
  RETRY_PENDING:      ['SUBMITTED', 'RETRY_EXHAUSTED'],
  RETRY_EXHAUSTED:    [],                                        // terminal — operator intervention
  ACK_AMBIGUOUS:      ['ACKED', 'REJECTED', 'RETRY_PENDING'],    // resolved only via reconciliation
} as const;
```

---

## 6. BrokerResponse

Normalized envelope for any broker interaction (submit ack, fill push, rejection, error). Raw payload preserved verbatim for audit; everything else is Phase 7's normalized read.

```typescript
export interface BrokerResponse {
  readonly response_id: string;
  readonly order_request_id: string;
  readonly broker_order_id: string | null;        // null if broker never acked
  readonly raw_status: string;                     // broker's own status string, verbatim
  readonly normalized_status: OrderStatus;         // Phase 7's mapping of raw_status
  readonly reject_reason: string | null;           // verbatim, broker-sourced only
  readonly retryable: boolean;                     // classification, not a guess
  readonly latency_ms: number;
  readonly received_at: Date;
  readonly raw_payload: Record<string, unknown>;   // unmodified broker response, audit trail
}
```

---

## Explicitly Modeled (per spec)

| Requirement | Where |
|---|---|
| Partial fills | `OrderPartiallyFilledEvent`, `FillEvent.is_partial`, `cumulative_filled_qty`/`remaining_qty` |
| Rejected orders | `OrderRejectedEvent` (source + retryable flag), `OrderStatus = 'REJECTED'` |
| Retry states | `RetryState`, `OrderRetryScheduledEvent`, `OrderRetryExhaustedEvent`, `RETRY_PENDING`/`RETRY_EXHAUSTED`/`ACK_AMBIGUOUS` statuses |
| Slippage | `SlippageInfo` — signed abs + bps, directional classification, deterministic source field |

## Out of Scope (by instruction)

No DB schema. No learning/AI logic. No Phase 9 references. No bracket/child order linkage. No `account_id` resolution mechanism — flagged, not solved.
