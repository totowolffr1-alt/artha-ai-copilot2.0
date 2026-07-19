# Artha AI — Phase 7: Execution Output Contract v1

This is the contract Phase 9 reads. Nothing else from Phase 7 is exposed downstream — Phase 9 never queries Phase 5/6 internals or Phase 3 tables directly for execution outcomes. (It may still read Phase 5's `SignalEvent` for signal *features* — that's a separate concern. This document is the only source of truth for what actually happened to an order.)

Builds on `phase7-execution-domain-model-v1.md` and `phase7-execution-state-machine-v1.md`. Reuses their vocabulary, doesn't redefine it.

---

## 1. Traceability Chain

```
SignalEvent.signal_id
   └─► TradeIntent.intent_id           (Phase 6 verdict fused with Phase 5 signal data)
         └─► OrderRequest.order_request_id   (one per physical submission attempt)
               └─► logical order_id          (stable across retries — see §2.3)
                     └─► ExecutionEvent[]     (append-only, one per occurrence)
                           └─► ExecutionResult (derived, written once, at terminal status)
```

Every record at every layer carries the keys needed to walk this chain in either direction. No layer is permitted to drop a key it received from upstream.

---

## 2. ExecutionEvent

### 2.1 — Required fields (per spec)

`signal_id`, `order_id`, `trade_intent_id`, `status`, `fill_price`, `fill_quantity`, `slippage`, `execution_latency_ms`, `broker_timestamp`.

### 2.2 — Added fields (beyond spec, justified)

| Field | Why it's necessary |
|---|---|
| `event_id` | An append-only log without a unique-per-record id isn't append-only — it's unidentifiable. Required for Phase 9 to dedup/page/replay. |
| `occurred_at` | `execution_latency_ms` is *derived from* this timestamp. Can't have the derived field without the source field existing on the record. |
| `order_request_id` | The state machine doc allows a retry to spawn a new physical `OrderRequest` under the same logical order. Without this field, two attempts' events are indistinguishable in the log. |
| `account_id`, `symbol_id`, `direction` | "Only source of truth" means Phase 9 shouldn't have to join back into Phase 5/6 internals to know what instrument or account an outcome belongs to. Added for self-containment. `account_id` specifically is still an **unresolved upstream gap** (no resolver exists in Phase 6 or Phase 5) — carried forward as-is, not solved here. |

### 2.3 — `order_id` vs `order_request_id`

These are not the same thing and the distinction matters for `ExecutionResult` to mean anything:

- `order_request_id` = one physical broker submission attempt. Changes on every retry.
- `order_id` = the **logical order** — the state-machine-scoped identity that stays constant across all retry attempts of the same intent (functionally the same scope as `idempotency_key` in the broker abstraction layer).

`ExecutionResult` aggregates by `order_id`, across however many `order_request_id` attempts occurred underneath it.

### 2.4 — Interface

```typescript
export type ExecutionLifecycleStatus =
  | 'CREATED'
  | 'SENT_TO_BROKER'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'CANCELLED';
// Mirrors phase7-execution-state-machine-v1.md's six states verbatim.
// Retry/ack-ambiguity sub-conditions stay internal — Phase 9 never sees them.

export interface ExecutionEvent {
  readonly event_id: string;
  readonly occurred_at: Date;

  // Traceability chain
  readonly signal_id: string;
  readonly trade_intent_id: string;
  readonly order_id: string;             // logical order — stable across retries
  readonly order_request_id: string;     // this specific physical attempt

  // Self-containment
  readonly account_id: string;           // UNRESOLVED UPSTREAM — see §5
  readonly symbol_id: string;
  readonly direction: 'LONG' | 'SHORT';

  readonly status: ExecutionLifecycleStatus;   // resulting status as of this event

  readonly fill_price: number | null;          // null unless this event IS a fill
  readonly fill_quantity: number | null;       // per-fill amount, not cumulative — null unless a fill
  readonly slippage: number | null;            // signed basis points — null unless a fill occurred

  readonly execution_latency_ms: number;       // occurred_at − TradeIntent.received_at (fixed anchor, every event type)
  readonly broker_timestamp: Date | null;      // broker/exchange-side time; null only if this event never reached a broker
}
```

### 2.5 — Nullability rules by status

| `status` | `fill_price` / `fill_quantity` / `slippage` | `broker_timestamp` |
|---|---|---|
| `CREATED` | null | null — never reached broker |
| `SENT_TO_BROKER` | null | non-null once acked; null while awaiting ack |
| `PARTIALLY_FILLED` | non-null (this fill's values) | non-null |
| `FILLED` | non-null (this fill's values) | non-null |
| `REJECTED` (broker-side) | null | non-null |
| `REJECTED` (pre-submission) | null | **null** — never reached broker |
| `CANCELLED` | null | non-null if broker confirmed cancel; null if cancelled before dispatch |

A `null` here is never ambiguous — each case above is the only reason a null is allowed to appear, and a consumer can always tell *why* a field is null from `status` alone.

---

## 3. ExecutionResult

One record per logical `order_id`, written exactly once, only when that order reaches a terminal status (`FILLED`, `REJECTED` with retries exhausted, or `CANCELLED`). Never written for an order still in `CREATED` / `SENT_TO_BROKER` / `PARTIALLY_FILLED` — those have only their latest `ExecutionEvent` for visibility, no result yet.

`ExecutionResult` is never independently authored. It is always computed by folding every `ExecutionEvent` sharing that `order_id`. Two consumers folding the same event log must produce the same `ExecutionResult`, deterministically — that's the whole point of this layer existing.

```typescript
export interface ExecutionResult {
  readonly order_id: string;                  // logical order — same scope as ExecutionEvent.order_id
  readonly trade_intent_id: string;
  readonly signal_id: string;
  readonly account_id: string;                // UNRESOLVED UPSTREAM — see §5
  readonly symbol_id: string;
  readonly direction: 'LONG' | 'SHORT';

  readonly final_status: 'FILLED' | 'REJECTED' | 'CANCELLED';

  readonly requested_qty: number;             // = originating TradeIntent.approved_qty
  readonly total_filled_qty: number;          // 0 if final_status is REJECTED or fully unfilled CANCELLED
  readonly fill_count: number;                // number of fill-bearing ExecutionEvents folded in

  readonly avg_fill_price: number | null;     // volume-weighted, null if total_filled_qty = 0
  readonly realized_slippage_bps: number | null;   // volume-weighted, null if total_filled_qty = 0
  readonly total_commission: number;          // 0 if no fills

  readonly total_attempts: number;            // distinct order_request_id count under this order_id
  readonly opened_at: Date;                   // occurred_at of the first ExecutionEvent (CREATED)
  readonly closed_at: Date;                   // occurred_at of the terminal ExecutionEvent
  readonly total_execution_latency_ms: number;  // closed_at − TradeIntent.received_at, same anchor convention as §2.4

  readonly reject_reason: string | null;      // non-null only if final_status = REJECTED
  readonly cancel_reason: string | null;      // non-null only if final_status = CANCELLED
}
```

**Derivation rules** (folding, not assertion):

- `avg_fill_price = Σ(fill_price_i × fill_quantity_i) / Σ(fill_quantity_i)`, over every fill-bearing event for this `order_id`.
- `realized_slippage_bps` = the same volume-weighted average, applied to each fill's `slippage` value.
- `total_filled_qty = Σ(fill_quantity_i)` over the same set.
- `total_attempts` = count of distinct `order_request_id` values observed in the event log for this `order_id`.
- `final_status` must equal the `status` of the most recent terminal `ExecutionEvent` for this `order_id` — if it doesn't, that's a folding bug, not a legitimate divergence.

---

## 4. Source-of-Truth Rules

1. Phase 9 reads `ExecutionEvent` and `ExecutionResult` only, for anything execution-outcome-related. No reaching into Phase 6's `TradeApprovalResult`, Phase 7's internal `OrderStatus`/retry bookkeeping, or Phase 3 tables for this purpose.
2. Both types are append-only / write-once. `ExecutionEvent` is never updated or deleted after creation. `ExecutionResult` is written exactly once, at terminal status, and never revised — if a correction is ever needed, it's a new record with its own `event_id` lineage, not a mutation of history.
3. Every `ExecutionResult` must be reproducible from its `ExecutionEvent` log alone. If the fold can't be re-run and get the same answer, the contract is broken, not the implementation detail.

---

## 5. Open Gaps Carried Forward

`account_id` remains unresolved — no resolver exists anywhere upstream (Phase 5's `SignalEvent`, Phase 6's `TradeApprovalResult`, and Phase 7's `TradeIntent` all lack it). It's present on both types here because Phase 9 cannot do per-account analysis without it, but the field is a placeholder for a contract that doesn't exist yet, not a solved problem.

---

## 6. Naming Note

This document's `ExecutionEvent` is **not** the same type as the internal `ExecutionEvent` discriminated union (`OrderSubmittedEvent | OrderAckedEvent | ...`) defined in `phase7-execution-domain-model-v1.md`. That union is Phase 7-internal state-machine bookkeeping and is never exposed downstream. This document's `ExecutionEvent` is the external, Phase-9-facing, denormalized record. The name collision is flagged here, not resolved — if Phase 7 is implemented literally, the internal union should be renamed (e.g. `InternalExecutionEvent`) to avoid a same-name, different-shape conflict in code. That's an implementation note, not a redesign of either document.
