# Artha AI — Phase 7: Broker Abstraction Layer v1

Vendor-agnostic. No broker-specific auth schemes, endpoints, or field names appear anywhere below. Builds on `phase7-execution-domain-model-v1.md` (`OrderRequest`, `BrokerResponse`, `FillEvent`) and `phase7-execution-state-machine-v1.md` (reconciliation, retry, ambiguity rules) — reuses those types, doesn't redefine them.

---

## 1. IBrokerAdapter

```typescript
import type { OrderRequest, BrokerResponse, FillEvent } from './phase7-execution-domain-model-v1';

export interface OrderReference {
  readonly idempotency_key: string;
  readonly broker_order_id?: string;     // present once broker has acked — optional before that
}

export interface IBrokerAdapter {
  readonly adapter_mode: 'PAPER' | 'LIVE';

  placeOrder(request: OrderRequest): Promise<BrokerResponse>;

  cancelOrder(ref: OrderReference): Promise<BrokerResponse>;

  getOrderStatus(ref: OrderReference): Promise<BrokerResponse>;

  streamFills(
    onFill: (fill: FillEvent) => void,
    onError: (err: BrokerStreamError) => void
  ): BrokerSubscription;
}

export interface BrokerSubscription {
  readonly subscription_id: string;
  unsubscribe(): void;
}

export interface BrokerStreamError {
  readonly cause: 'CONNECTION_LOST' | 'AUTH_EXPIRED' | 'UNKNOWN';
  readonly occurred_at: Date;
  readonly recoverable: boolean;         // true → adapter auto-reconnects; false → caller must re-subscribe
}
```

`getOrderStatus()` is the literal mechanism behind the state machine's mandatory pre-retry reconciliation (§5.4) and ack-timeout resolution (§6) in the lifecycle doc. It is not a convenience method — the no-duplicate-execution guarantee depends on it existing and being honest.

`streamFills()` delivery is at-least-once, never at-most-once. Phase 7's fill processor — not this layer — is responsible for deduping on `FillEvent.broker_fill_id` if the same fill arrives twice. The adapter is explicitly permitted to over-deliver, never permitted to silently drop.

---

## 2. Latency Constraints

```typescript
export interface BrokerLatencyConfig {
  readonly place_order_timeout_ms: number;       // hard cap, enforced inside the adapter, not by caller
  readonly cancel_order_timeout_ms: number;
  readonly get_status_timeout_ms: number;
  readonly status_max_staleness_ms: number;      // a cached read older than this must be rejected, not served
  readonly stream_reconnect_backoff_ms: number;
  readonly stream_max_reconnect_attempts: number;
}

export const DEFAULT_LATENCY_CONFIG: BrokerLatencyConfig = {
  place_order_timeout_ms: 3000,
  cancel_order_timeout_ms: 2000,
  get_status_timeout_ms: 1500,
  status_max_staleness_ms: 500,
  stream_reconnect_backoff_ms: 1000,
  stream_max_reconnect_attempts: 5,
};
```

Rule: every method has a hard timeout the adapter itself enforces — never an indefinite hang passed up to the caller. On timeout, the adapter must resolve to a typed ambiguous outcome (not silence, not a guessed success/failure) — see §3.

`status_max_staleness_ms` exists because `getOrderStatus()` backs reconciliation. A reconciliation read that's secretly 30 seconds stale is worse than no read at all — it would let a retry fire against outdated truth.

---

## 3. Retry Handling Rules

Two retry layers exist and must not be confused: **adapter-level** (this document — transport/connection retry) and **orchestration-level** (the lifecycle doc's `REJECTED → SENT_TO_BROKER`). This layer never makes resubmission decisions — it only decides whether to retry its own plumbing.

| Method | May the adapter retry internally? | Why |
|---|---|---|
| `placeOrder()` | **No, never**, once the request may have left the local process | If the call fails after dispatch, the adapter cannot know whether the broker received it. Blind retry here is exactly the duplicate-execution failure mode. Adapter must surface this as an ambiguous `BrokerResponse` (`normalized_status: 'ACK_AMBIGUOUS'`) and let the orchestration layer reconcile via `getOrderStatus()` before anything resubmits. |
| `cancelOrder()` | **No, not blindly** | Same ambiguity: a failed cancel call might have actually succeeded at the broker, or the order might have filled in the interim. Adapter surfaces ambiguous result; caller must call `getOrderStatus()` first, then decide whether to re-issue cancel. |
| `getOrderStatus()` | **Yes** | Read-only, idempotent, no execution side effect. Internal retry on transport failure is safe and expected — bounded by `get_status_timeout_ms` per attempt. |
| `streamFills()` | **Yes, reconnect only** | Losing the stream and reconnecting is safe — at-least-once delivery means a reconnect just risks redundant fills, which the dedup rule (§1) already covers. Bounded by `stream_reconnect_backoff_ms` × `stream_max_reconnect_attempts`; exhausting it surfaces `BrokerStreamError` with `recoverable: false`. |

Adapter-level retries (the `Yes` rows) are still bounded, never unconditional — same no-infinite-loop discipline as the orchestration layer, just scoped to plumbing instead of order decisions.

---

## 4. Paper Trading Adapter

Fully local, deterministic, zero network calls. Exists to validate Phase 6 → Phase 7 wiring without broker risk.

```typescript
export class PaperBrokerAdapter implements IBrokerAdapter {
  readonly adapter_mode = 'PAPER';

  constructor(private readonly config: BrokerLatencyConfig = DEFAULT_LATENCY_CONFIG) {}

  async placeOrder(request: OrderRequest): Promise<BrokerResponse> {
    // Deterministic simulation only — e.g. immediate fill at reference price,
    // or configurable fault injection (forced REJECTED / partial fill / simulated
    // ACK_AMBIGUOUS) for exercising the lifecycle doc's edge-case rules in tests.
    // No real ambiguity exists here by default; injected ambiguity is opt-in only.
    throw new Error('simulation body intentionally omitted — abstraction-layer spec only');
  }

  async cancelOrder(ref: OrderReference): Promise<BrokerResponse> {
    throw new Error('simulation body intentionally omitted — abstraction-layer spec only');
  }

  async getOrderStatus(ref: OrderReference): Promise<BrokerResponse> {
    throw new Error('simulation body intentionally omitted — abstraction-layer spec only');
  }

  streamFills(
    onFill: (fill: FillEvent) => void,
    onError: (err: BrokerStreamError) => void
  ): BrokerSubscription {
    throw new Error('simulation body intentionally omitted — abstraction-layer spec only');
  }
}
```

Default behavior must be fully deterministic (no randomness without an explicit injected seed/fault config) — paper mode is a contract-conformance and rehearsal tool, not a market simulator.

---

## 5. Live Trading Adapter (mock only)

Same shape `IBrokerAdapter` requires. No vendor wiring. Exists only to prove the contract is implementable against something that *looks* live — auth handshake, network call, response mapping — without committing to any vendor's protocol.

```typescript
export class LiveBrokerAdapterMock implements IBrokerAdapter {
  readonly adapter_mode = 'LIVE';

  constructor(private readonly config: BrokerLatencyConfig = DEFAULT_LATENCY_CONFIG) {}

  async placeOrder(request: OrderRequest): Promise<BrokerResponse> {
    // Real implementation would: authenticate, translate OrderRequest into the
    // vendor's wire format, call the vendor's order endpoint, map the vendor's
    // response back onto BrokerResponse. None of that exists here.
    throw new Error('mock only — no live vendor integration exists in this layer');
  }

  async cancelOrder(ref: OrderReference): Promise<BrokerResponse> {
    throw new Error('mock only — no live vendor integration exists in this layer');
  }

  async getOrderStatus(ref: OrderReference): Promise<BrokerResponse> {
    throw new Error('mock only — no live vendor integration exists in this layer');
  }

  streamFills(
    onFill: (fill: FillEvent) => void,
    onError: (err: BrokerStreamError) => void
  ): BrokerSubscription {
    throw new Error('mock only — no live vendor integration exists in this layer');
  }
}
```

This is not production-ready and isn't meant to become it by filling in the throws — a real live adapter needs its own vendor-specific design pass, explicitly out of scope here.

---

## 6. Cross-Document Ties

| This layer provides | Consumed by |
|---|---|
| `getOrderStatus()` | State machine §5.4 (pre-retry reconciliation), §6 (ack/reconciliation timeout resolution) |
| `BrokerResponse.normalized_status` incl. `ACK_AMBIGUOUS` | State machine's ambiguity handling — adapter never resolves ambiguity itself, only reports it |
| `streamFills()` + `FillEvent.broker_fill_id` | Domain model's `FillEvent` dedup key — fill processor's responsibility, not this layer's |
| `adapter_mode: 'PAPER' \| 'LIVE'` | Lets orchestration code branch on environment without ever branching on vendor |

---

## 7. Explicit Exclusions

No broker named, no vendor auth flow, no vendor-specific order types or status strings, no real network code, no live order placement logic. Two adapters exist purely to prove the interface is implementable in both modes — neither is deployable as-is.
