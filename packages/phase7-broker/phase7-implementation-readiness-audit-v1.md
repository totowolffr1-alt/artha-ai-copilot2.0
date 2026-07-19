# Artha AI — Phase 7: Implementation Readiness Audit

**Auditor role:** Principal Quant Systems Architect
**Audit scope:** Phase 7 design documents (all five) + Phase 3 database architecture + Phase 6 complete design + Phase 6 audits
**Audit date:** 2026-06-19
**Audit type:** Implementation-readiness. Not a design validation. Question is: can a developer begin writing Phase 7 production code today?

---

## Classification Criteria

| Class | Definition |
|---|---|
| **IMPLEMENTATION BLOCKER** | Cannot write correct, committable Phase 7 code without resolving this first. An attempt will produce wrong code or introduce a permanent design defect — not just a test failure. |
| **PRE-LIVE BLOCKER** | Code can be written and paper-tested. Must be resolved before any live/real-broker execution. A known-incomplete path, not a broken design. |
| **DOCUMENTATION GAP** | Design intent is clear enough to write code; the gap is in what's written down, not in what the system will do. Can be fixed after coding begins. |
| **FUTURE PHASE DEPENDENCY** | Genuinely not Phase 7's problem. Phase 7 code is correct and complete regardless. Blocked path belongs to a different phase's design pass. |

---

## Item-by-Item Classification

---

### 1. `account_id` ownership

**Finding:** `TradeIntent.account_id` is required on every Phase 7 type. No upstream resolver exists. Neither `SignalEvent` nor `TradeApprovalResult` carries it.

**Classification: PRE-LIVE BLOCKER**

**Reasoning:** Phase 7 code can be written against a declared-but-unstubbed `IAccountResolver` interface. The interface does not yet exist, but defining it as a Phase 7 boundary (one method: `resolve(strategy_run_id): string`) is a Phase 7 design act, not a cross-phase dependency. Paper mode tests can run with a hardcoded single-account mock behind the interface. The gap is not in the code structure — it is in wiring real account state to that interface. That wiring cannot happen until a resolver is built, but building the interface and implementing the state machine against it is fully unblocked today.

**What must happen before live:** Real `IAccountResolver` implementation with actual account-to-strategy-run mapping, vetted against `risk_limits` (account-scoped) in Phase 3.

---

### 2. `signal_st` enum mismatch

**Finding:** Phase 3 frozen enum `signal_st = pending | acted | expired | rejected | cancelled`. Phase 5's rejection write-back path writes `approved` / `suppressed` — values that don't exist in the enum. Phase 7 is the caller of `ISignalRejectionWriter.markRejected()` on `REJECTED` verdicts.

**Classification: PRE-LIVE BLOCKER**

**Reasoning:** Phase 7 code does not own this enum, does not write it, and does not define it. `ISignalRejectionWriter` is a Phase 5 interface — Phase 7 calls it; Phase 5's implementation executes the write. The Phase 7 module that calls `markRejected()` can be fully written and unit-tested against a mock of `ISignalRejectionWriter` without touching the DB enum. The enum mismatch causes a DB-layer failure when the real Phase 5 implementation runs against a real Phase 3 DB — not when Phase 7's code compiles or runs against mocks. Paper mode can run completely if the paper `IBrokerAdapter` does not exercise the real DB path.

**What must happen before live:** Phase 3 migration amending `signal_st` to include the values Phase 5 actually writes. This is a Phase 3 / Phase 5 fix. Phase 7 has no action here beyond the call site it already owns.

---

### 3. `corporate_events` dependency

**Finding:** Phase 3 contains no `corporate_events` table across migrations 001–019. Phase 6 Stage 5 `EventRiskChecker` (steps 5b–5e) reads from it. Without the table, Stage 5 fails at runtime, which means Phase 6 never produces an `APPROVED` verdict for affected signals. Phase 7 receives no inputs and has no visibility into why.

**Classification: PRE-LIVE BLOCKER**

**Reasoning:** Phase 7 owns none of this code. Phase 7's input is a `TradeApprovalResult` — how Phase 6 produced it is Phase 6's domain entirely. Phase 7 can be fully implemented and tested in isolation with synthetically produced `TradeApprovalResult` objects (APPROVED/REDUCED_SIZE/REJECTED) that don't require Phase 6 to have actually run. The starvation risk — Phase 7 silently receiving zero approved intents in an end-to-end environment — is a Phase 6 runtime defect, not a Phase 7 design defect. Phase 7 code is correct and complete regardless of whether this table exists.

**What must happen before live:** Phase 3 migration creating `corporate_events`, and Phase 6 Stage 5 verified non-fatal when table is empty vs absent. Not Phase 7's migration to write.

---

### 4. `PortfolioSnapshot` gap

**Finding:** Phase 6's `IRiskEngine.evaluate(signal, portfolio)` requires `PortfolioSnapshot` as a second argument. The type is undefined anywhere in the design corpus. No builder, cache, or aggregator owns it.

**Classification: FUTURE PHASE DEPENDENCY**

**Reasoning:** Phase 7 does not call `evaluate()`. Phase 7 receives `TradeApprovalResult` — the output of a Phase 6 evaluation that already ran. Phase 7 has zero interaction with `PortfolioSnapshot`. This gap is real and must be solved before Phase 6 can be invoked at runtime, but that's a Phase 6 completeness issue. Phase 7's design, code, and tests are entirely unaffected by whether this type exists or not.

**What must happen:** Phase 6 design pass to define `PortfolioSnapshot`, its builder, and its pre-computation ownership. Not Phase 7's design pass.

---

### 5. `MarketState` typing

**Finding:** `TradeApprovalResult.market_state` is typed as `string` in Phase 6's output. Phase 7's `ExecutionEvent` inherits it as `string`. Phase 9 (not yet designed) would need to switch on it programmatically.

**Classification: DOCUMENTATION GAP**

**Reasoning:** Phase 7 code that carries `market_state: string` is correct and complete. The field passes through — Phase 7 does not switch on it, does not interpret it, does not branch on it. Changing it to a proper enum later is a one-line type change in the `ExecutionEvent` definition that requires no state-machine or logic changes anywhere. Phase 9 does not exist yet, so there is no consumer that breaks today. Write the code with `string`; tighten the type before Phase 9 design begins.

**What must happen:** Define `MarketState` as a typed enum before Phase 9 design. Not before Phase 7 implementation.

---

### 6. `ExecutionEvent` naming collision

**Finding:** Phase 7 has two things named `ExecutionEvent`:
- **Internal:** Discriminated union in `phase7-execution-domain-model-v1.md` — `OrderSubmittedEvent | OrderAckedEvent | OrderPartiallyFilledEvent | ...` — used by the state machine for internal bookkeeping.
- **External:** Output contract record in `phase7-execution-output-contract-v1.md` — the Phase 9-facing denormalized event log record.

Same name. Incompatible shapes. Both TypeScript types, both in Phase 7's own codebase.

**Classification: IMPLEMENTATION BLOCKER**

**Reasoning:** This is not a documentation gap. If a developer begins writing Phase 7 code today against both documents without renaming one, they create a type collision in the same codebase on the first day. The collision is unresolvable without a rename — it cannot be worked around with imports because both names are `ExecutionEvent` and both are legitimate types that will be referenced across multiple files. Any code written before the rename is named wrong and must be changed. This is a zero-cost fix *before coding starts* and a non-trivial refactor *after*. Resolution: rename the internal discriminated union to `InternalOrderEvent` (or equivalent) before the first `.ts` file is created.

**What must happen before coding:** Rename internal discriminated union in `phase7-execution-domain-model-v1.md`. One decision, one document edit, five minutes.

---

### 7. `ISignalRejectionWriter` call site ownership

**Finding:** Phase 7 is documented as the caller of `ISignalRejectionWriter.markRejected(signal_id, reasons)` on `REJECTED` verdicts. No Phase 7 document names which specific Phase 7 *component* (module, service, handler) holds this responsibility. Phase 7's module breakdown has not been defined yet. The call must happen somewhere — the design just hasn't said where.

**Classification: IMPLEMENTATION BLOCKER**

**Reasoning:** This is not a documentation gap in the sense that the intent is clear — Phase 7 must call it. The blocker is that module structure cannot be finalized without knowing which component owns this call. If a developer starts writing Phase 7 modules today, they will either: (a) duplicate the call across multiple components (producing multiple rejection writes for one signal), or (b) skip it entirely until someone decides. Neither outcome is acceptable. The call is the sole Phase 7 action that crosses the Phase 5 boundary — it must be owned by exactly one named component, verified against the no-duplicate-write constraint. This is a design decision, not an implementation task — it takes a single architectural decision (e.g. `ExecutionOrchestrator.onRejectedVerdict()`) to resolve. But it must be made before any module scaffolding begins.

**What must happen before coding:** Name the specific Phase 7 component that calls `ISignalRejectionWriter`, document it as that component's sole responsibility for this interface, and confirm it cannot be called from more than one place.

---

## Summary Table

| Item | Classification | Blocks code today? | Blocks live? |
|---|---|---|---|
| `account_id` ownership | **PRE-LIVE BLOCKER** | No — define `IAccountResolver` interface, mock for paper | Yes |
| `signal_st` enum mismatch | **PRE-LIVE BLOCKER** | No — Phase 7 code mocks the interface | Yes |
| `corporate_events` dependency | **PRE-LIVE BLOCKER** | No — Phase 7 not involved | Yes |
| `PortfolioSnapshot` gap | **FUTURE PHASE DEPENDENCY** | No — Phase 7 doesn't call `evaluate()` | No (Phase 6's problem) |
| `MarketState` typing | **DOCUMENTATION GAP** | No — `string` works today | No |
| `ExecutionEvent` name collision | **IMPLEMENTATION BLOCKER** | **YES** | Yes |
| `ISignalRejectionWriter` ownership | **IMPLEMENTATION BLOCKER** | **YES** | Yes |

---

## Answers

### A. Can Phase 7 implementation begin today?

**No.**

Two implementation blockers exist. Neither requires weeks of upstream work — both are resolved by design decisions that take less than a day. But they must be resolved *before* the first file is created, not after.

---

### B. What specifically blocks implementation?

**Blocker 1 — `ExecutionEvent` naming collision (Item 6)**

Two incompatible types share the same name in Phase 7's own codebase. Writing any code before renaming one produces wrong names on the first day and a refactor-or-rename on the second. This is not a philosophical concern — TypeScript will not let two `export interface ExecutionEvent` definitions coexist in the same project without a namespace or rename.

**Blocker 2 — `ISignalRejectionWriter` ownership unassigned (Item 7)**

Phase 7 module scaffolding cannot begin without knowing which component owns the cross-phase rejection call. This is Phase 7's only cross-boundary write. Assigning it to the wrong component or leaving it unassigned leads to either silent omission (rejection write never happens, Phase 5 signal status stalls forever) or duplicate writes. The decision is: pick one named Phase 7 component, state it owns this call, and forbid the call from appearing anywhere else.

---

### C. Minimum set to resolve before coding starts

Two items, both resolvable today:

**Resolution 1 — Rename internal discriminated union**
In `phase7-execution-domain-model-v1.md`: rename `ExecutionEvent` (the internal discriminated union `OrderSubmittedEvent | OrderAckedEvent | ...`) to `InternalOrderEvent`. External output contract record in `phase7-execution-output-contract-v1.md` retains the name `ExecutionEvent` — it is the Phase 9-facing type and the name that should be preserved. One document edit, zero architectural change.

**Resolution 2 — Assign `ISignalRejectionWriter` call site**
In Phase 7 module design (a document that does not yet exist — this is the first item to produce): name the Phase 7 component that holds `ISignalRejectionWriter`. Based on current Phase 7 design structure, the natural owner is an `ExecutionOrchestrator` (the component that receives `TradeApprovalResult`, fuses it into `TradeIntent`, and dispatches `REJECTED` verdicts before any `OrderRequest` is created). This component should be the only one in Phase 7 with a reference to `ISignalRejectionWriter`. That rule must be stated explicitly in the module design doc, not just implied.

Nothing else.

PRE-LIVE BLOCKERs (Items 1–3) do not block code — they block live deployment, and all three are owned by Phase 3 or Phase 5 teams, not the Phase 7 implementation team.

---

## Go / No-Go Decision

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   VERDICT:  NO-GO                                           │
│                                                             │
│   Two implementation blockers must be resolved first.       │
│   Neither requires upstream phase changes.                  │
│   Both are resolved by design decisions, not code.          │
│                                                             │
│   Estimated time to resolve:  < 1 working day              │
│                                                             │
│   After resolution:  GO — with paper mode only.             │
│   Live mode requires three additional PRE-LIVE BLOCKERs     │
│   resolved by Phase 3 and Phase 5 teams independently.      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Conditional GO criteria:**

1. `InternalOrderEvent` rename confirmed in `phase7-execution-domain-model-v1.md`
2. Phase 7 module design doc created, naming `ExecutionOrchestrator` (or equivalent) as sole owner of `ISignalRejectionWriter` call, with explicit prohibition on other Phase 7 components calling it
3. `IAccountResolver` interface drafted as a Phase 7 boundary contract (empty implementation acceptable for paper mode)

All three are Phase 7 design acts. No Phase 5 or Phase 6 changes required to begin implementation.

---

*Audit complete. Findings are against design documents only. No implementation has been reviewed.*
