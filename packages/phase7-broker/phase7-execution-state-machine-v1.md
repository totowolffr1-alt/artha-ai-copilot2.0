# Artha AI — Phase 7: Execution Lifecycle State Machine v1

Pure state machine definition. No implementation code. Six locked states, per spec. This sits one level coarser than `OrderStatus` in `phase7-execution-domain-model-v1.md` — mapping at the bottom, no redesign of that doc.

This state machine is scoped to a **logical order** (one `idempotency_key`), not a single physical broker submission. A retry produces a new physical attempt under the same logical order — state lives at the logical level so retries don't reset history.

---

## 1. States

| State | Meaning | Entry condition | Fill count |
|---|---|---|---|
| `CREATED` | OrderRequest built, not yet dispatched to broker | TradeIntent fused into OrderRequest | 0 |
| `SENT_TO_BROKER` | Dispatched, awaiting broker disposition (ack, fill, reject) | Submission attempt fired | 0 |
| `PARTIALLY_FILLED` | At least one fill recorded, qty remaining > 0 | First partial fill confirmed | 1+ |
| `FILLED` | Remaining qty = 0, terminal | Final fill confirmed | 1+ |
| `REJECTED` | Zero fills, order will not execute as submitted | Broker reject or pre-submission validation reject | 0 |
| `CANCELLED` | Voluntarily or system-terminated, any fill count, no further fills will occur | Operator/system cancel, or validity lapse | 0+ |

`REJECTED` and `CANCELLED` are semantically distinct and never merge: `REJECTED` = order never executed as intended; `CANCELLED` = order withdrawn, possibly after partial execution. Conflating them would hide partial-fill exposure from downstream reconciliation.

---

## 2. State Diagram

```
CREATED ──submit──► SENT_TO_BROKER ──first fill──► PARTIALLY_FILLED ──remaining fills──► FILLED
   │                     │  │                           │
   │                     │  └──cancel (zero fill)──► CANCELLED ◄──cancel (remaining qty)──┘
   │                     │
   │                     └──reject──► REJECTED ──retry (bounded)──► SENT_TO_BROKER
   │
   └──pre-submission reject──► REJECTED (not retryable)
   └──withdrawn before dispatch──► CANCELLED
```

`PARTIALLY_FILLED` self-loops on each additional partial fill (qty accumulates, state name unchanged). `SENT_TO_BROKER` has no self-loop in this diagram — ambiguous-ack handling is a rule (§6), not a transition.

---

## 3. Valid Transitions

| From | To | Trigger | Condition |
|---|---|---|---|
| `CREATED` | `SENT_TO_BROKER` | Submission dispatched | Always, on first attempt |
| `CREATED` | `REJECTED` | Pre-submission validation failure | Order never reached broker — malformed, stale intent, etc. **Not retryable.** |
| `CREATED` | `CANCELLED` | Withdrawn before dispatch | E.g. circuit breaker trips between approval and dispatch |
| `SENT_TO_BROKER` | `PARTIALLY_FILLED` | Broker reports partial fill | `fill_qty < order qty` |
| `SENT_TO_BROKER` | `FILLED` | Broker reports full fill in one fill | `fill_qty = order qty` |
| `SENT_TO_BROKER` | `REJECTED` | Broker reject confirmed | Confirmed via ack or reconciliation — never inferred from silence |
| `SENT_TO_BROKER` | `CANCELLED` | Cancel before any fill, or validity lapses unfilled | Zero fills at time of cancellation |
| `PARTIALLY_FILLED` | `PARTIALLY_FILLED` | Additional partial fill | Remaining qty still > 0 after this fill |
| `PARTIALLY_FILLED` | `FILLED` | Final fill closes remaining qty | Remaining qty = 0 |
| `PARTIALLY_FILLED` | `CANCELLED` | Remaining open qty cancelled | Already-filled qty stands as-is; only the unfilled remainder is voided |
| `REJECTED` | `SENT_TO_BROKER` | Retry resubmission | Only if reject classified retryable AND attempt count < max — governed entirely by §5 |

That's the complete valid set. Eleven transitions, six states.

---

## 4. Invalid Transitions

Explicit, not just "everything else." Each one is invalid for a stated reason, not by omission.

| From → To | Why invalid |
|---|---|
| `FILLED` → anything | Terminal. Order fully executed, nothing left to transition. |
| `CANCELLED` → anything | Terminal. No resurrection of a cancelled order — a new order is a new `CREATED`, not a transition out of `CANCELLED`. |
| `CREATED` → `PARTIALLY_FILLED` / `FILLED` | Cannot fill before dispatch. Must pass through `SENT_TO_BROKER`. |
| `CREATED` → `CREATED` | Not a transition — construction is instantaneous, not re-entrant. |
| `PARTIALLY_FILLED` → `REJECTED` | Rejection means zero execution. Once any fill exists, rejection is no longer a true description of what happened. |
| `PARTIALLY_FILLED` → `CREATED` / `SENT_TO_BROKER` | No going backward once execution has started. A stalled partial fill is cancelled (remainder), never re-dispatched as if new. |
| `REJECTED` → `PARTIALLY_FILLED` / `FILLED` / `CANCELLED` | Rejected orders only ever go back to `SENT_TO_BROKER` (retry) or stay `REJECTED` (exhausted/non-retryable). They do not skip ahead to an execution outcome, and are not relabelled as cancelled — see §1 distinction. |
| `SENT_TO_BROKER` → `CREATED` | No going backward. Once dispatched, the only forward paths are fill, reject, or cancel. |
| Any retry of `PARTIALLY_FILLED` or `FILLED` | Retry is defined only for zero-fill rejection. Retrying an order that already has fills risks duplicate exposure — structurally disallowed, not just discouraged. |

---

## 5. Retry Rules

Retry applies **only** from `REJECTED`, **only** when the reject was classified retryable (broker-side transient failure — rate limit, 5xx, network drop — not a structural/validation reject).

1. **Eligibility:** `REJECTED` + `retryable = true` + `attempt < max_attempts`. Any one false → no retry, state stays `REJECTED`, terminal.
2. **Bounded attempts:** `max_attempts` fixed per logical order at creation, not extendable mid-flight. Exhausting it sets a terminal `REJECTED` with `retries_exhausted = true` — escalates to operator, does not loop further. This is the infinite-loop guard: the counter only increments, never resets, for the life of one `idempotency_key`.
3. **Backoff required:** each retry waits `backoff_ms` before resubmission, increasing per attempt (capped). No immediate back-to-back resubmission under any condition.
4. **Pre-retry reconciliation is mandatory:** before transitioning `REJECTED → SENT_TO_BROKER`, Phase 7 must query the broker for the existing `idempotency_key` / prior `broker_order_id` and confirm it is genuinely absent or genuinely terminal-rejected at the broker. If reconciliation shows the broker actually has an open or filled order under that key, the retry is aborted — state corrects to whatever reconciliation reveals (`SENT_TO_BROKER`, `PARTIALLY_FILLED`, or `FILLED`) instead of resubmitting. This is the primary defense against duplicate execution (full rule in §7).
5. **Same `idempotency_key`, new `order_request_id`:** a retry is a new physical attempt object, never a mutation of the rejected one. The logical state machine (this document) tracks the key; the domain model tracks each attempt.
6. **No retry chains across rejections of different cause:** if reconciliation itself fails or times out, do not retry — escalate (§6, reconciliation timeout). Retry only proceeds on a clean, confirmed-absent result.

---

## 6. Timeout Rules

Three independent timeout categories. None of them auto-resolve into a terminal state without positive confirmation — that's the determinism guarantee.

**Ack timeout** (`SENT_TO_BROKER`, awaiting initial acknowledgment): if no ack within the bound, state does **not** change. Condition is "ambiguous" — trigger a reconciliation query. Resolution:
- Broker confirms no record → transition to `REJECTED`, classified retryable.
- Broker confirms order exists → remain `SENT_TO_BROKER`, resume normal tracking.
- Broker doesn't answer reconciliation either → escalate, see reconciliation timeout below. State stays `SENT_TO_BROKER` (last known truth), flagged for operator visibility.

**Validity / fill timeout** (`SENT_TO_BROKER` or `PARTIALLY_FILLED`, order's `DAY`/`IOC`/`GTD` validity lapses): system-initiated cancel.
- Zero fills at lapse → `SENT_TO_BROKER → CANCELLED`, reason `validity_expired`.
- Partial fills at lapse → `PARTIALLY_FILLED → CANCELLED`, reason `validity_expired`, already-filled qty unaffected.
- Never silently reinterpreted as `REJECTED` — a lapsed order isn't a rejection, it's a voluntary-by-default withdrawal.

**Reconciliation timeout** (the query itself, used by both ack-timeout handling and pre-retry reconciliation, doesn't respond in time): no state transition is permitted on an unresolved reconciliation. The order is held at its last confirmed state and flagged for manual operator resolution. This is intentional — guessing here is exactly the failure mode that causes duplicate execution.

---

## 7. Idempotency Rules

1. **One `idempotency_key` per logical order**, generated once at `CREATED`, derived from `TradeIntent.intent_id`. Never regenerated for any retry of that same logical order.
2. **Single in-flight attempt per key:** only one physical submission may be outstanding under a given `idempotency_key` at any time. A new attempt cannot be dispatched while a prior attempt's disposition is unconfirmed — this is what ack-timeout and reconciliation rules exist to enforce.
3. **No resubmission without confirmed-terminal prior state:** Phase 7 may only move `REJECTED → SENT_TO_BROKER` after confirming (via reconciliation, §5.4) that the prior attempt is genuinely terminal at the broker. This holds even if the broker platform itself doesn't guarantee server-side dedup — Phase 7 owns the guarantee internally rather than assuming the broker provides it.
4. **Key scope is the logical order, not the attempt:** `order_request_id` changes per attempt; `idempotency_key` does not. Anything joining execution history back to a single intent joins on the key, not the attempt id.

---

## 8. Guarantees — Rule to Outcome

| Required guarantee | Enforced by |
|---|---|
| No duplicate order execution | §7.2 (single in-flight per key) + §5.4 (mandatory pre-retry reconciliation) + §6 (no auto-transition on ambiguity) |
| No infinite retry loops | §5.2 (fixed, non-resettable `max_attempts`, terminal on exhaustion) |
| Deterministic transitions | §3/§4 (closed transition set, explicit invalid list) + §6 (ambiguous conditions never silently resolved) |

---

## 9. Relationship to `phase7-execution-domain-model-v1.md`

This document's six states are coarser than that document's `OrderStatus`. Mapping, for consistency — no redesign of either:

| This document (6 states) | Domain model `OrderStatus` |
|---|---|
| `CREATED` | `PENDING_SUBMISSION` |
| `SENT_TO_BROKER` | `SUBMITTED`, `ACKED`, `OPEN`, `ACK_AMBIGUOUS` (transient, reconciling) |
| `PARTIALLY_FILLED` | `PARTIALLY_FILLED` |
| `FILLED` | `FILLED` |
| `REJECTED` | `REJECTED`, `RETRY_PENDING`, `RETRY_EXHAUSTED` |
| `CANCELLED` | `CANCELLED`, `EXPIRED` |

`RETRY_PENDING` / `RETRY_EXHAUSTED` are sub-conditions of `REJECTED` here (flags, not states) — same object, two granularities.
