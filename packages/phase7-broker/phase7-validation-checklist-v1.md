# Artha AI — Phase 7: Design Validation Checklist v1

Audit of Phase 7 design documents against architectural requirements. References `phase7-execution-domain-model-v1.md`, `phase7-execution-state-machine-v1.md`, `phase7-broker-abstraction-v1.md`, `phase7-execution-output-contract-v1.md`, `phase7-integration-map-v1.md`.

---

## 1. Required Checks

### ✅ PASS — Phase 7 does NOT introduce signal generation

Phase 7's input boundary begins at `TradeApprovalResult` + `SignalEvent` (via read-only join). No Phase 7 document defines, imports, or invokes `SignalEngine`, `RegimeEngine`, `SignalEmitter`, or any type that produces a `SignalEvent`. `TradeIntent` is a *fusion of upstream objects*, not a new signal. Phase 7 consumes a signal that Phase 5 already fired — it does not create one.

---

### ✅ PASS — Phase 7 does NOT modify risk logic

Phase 7 accepts `TradeApprovalResult.decision` as final truth. No document in the Phase 7 design set imports `RiskValidationPipeline`, `ConvictionScorer`, `DrawdownChecker`, or any Phase 6 stage checker. Phase 7 has no path to override `suggestedSize`, `confidence`, `decision`, or `reasons`. If Phase 7 needs to decline execution (circuit breaker, broker rejection), it records the outcome — it does not issue a new risk verdict. This is enforced structurally: `evaluate()` is zero-import of Phase 7 types; Phase 6 doesn't know Phase 7 exists.

---

### ✅ PASS — Phase 7 maintains idempotent execution

Three-layer guarantee established in the design:

1. **Single `idempotency_key` per logical order**, generated once at `CREATED`, stable across all retry attempts (`phase7-execution-state-machine-v1.md §7`).
2. **Single in-flight attempt rule** — a second submission cannot fire while any prior attempt's disposition is unconfirmed (`phase7-execution-state-machine-v1.md §7.2`).
3. **Mandatory pre-retry reconciliation** — before `REJECTED → SENT_TO_BROKER`, `IBrokerAdapter.getOrderStatus()` must confirm the prior attempt is genuinely terminal at the broker. No blind retry, ever (`phase7-execution-state-machine-v1.md §5.4`, `phase7-broker-abstraction-v1.md §3`).

The no-duplicate-execution guarantee is structural, not a runtime toggle.

---

### ✅ PASS — Phase 7 produces full execution traceability

End-to-end chain defined and key-pinned at every layer:

```
signal_id → trade_intent_id → order_id (logical) → order_request_id (per attempt) → ExecutionEvent[] → ExecutionResult
```

`ExecutionEvent` carries all six keys simultaneously (`signal_id`, `trade_intent_id`, `order_id`, `order_request_id`, `symbol_id`, `direction`) — no join into Phase 5/6 internals required to reconstruct what happened and why. `ExecutionResult` folds the full event log deterministically; same input always produces same result. Phase 9 reads this contract only — it never queries Phase 6 or Phase 5 for execution outcomes (`phase7-execution-output-contract-v1.md §4`).

---

### ✅ PASS — Phase 7 supports paper + live mode

`IBrokerAdapter.adapter_mode: 'PAPER' | 'LIVE'` is a first-class field on the interface, not a flag buried in config. `PaperBrokerAdapter` and `LiveBrokerAdapterMock` both implement `IBrokerAdapter` identically — the same orchestration code, state machine, and output contract run in both modes with zero branching (`phase7-broker-abstraction-v1.md §4, §5`). Mode selection is a deployment/injection concern, not a design-time conditional.

---

## 2. Remaining Ambiguities

| # | Ambiguity | Where it appears | Severity |
|---|---|---|---|
| A1 | `account_id` resolution — no upstream resolver; neither `SignalEvent` nor `TradeApprovalResult` carries it | Every Phase 7 doc | **High** — execution cannot be assigned to a capital pool without it |
| A2 | `MarketState` type — named in `TradeApprovalResult` output struct, never formally typed upstream; Phase 7 inherits it as a raw `string` | Domain model, output contract | Medium — functional, but Phase 9 can't programmatically switch on it |
| A3 | `PortfolioSnapshot` type — Phase 6 requires it as an `evaluate()` arg; no type definition, no aggregator owner, no builder exists anywhere | Pre-Phase 7 boundary | Medium — Phase 6 cannot be called by Phase 7 until this exists, but Phase 7 doesn't call `evaluate()` directly; still a gap in what hands Phase 7 its inputs |
| A4 | `trade_log` table naming — Phase 6 §7.2 names this as a Phase 7 write target; it does not exist in Phase 3 schema; Phase 7's own docs use `ExecutionEvent`/`ExecutionResult` instead | Output contract vs Phase 6 doc | Medium — naming inconsistency to resolve before DB schema pass |
| A5 | `ExecutionEvent` type name collision — Phase 7 has two things called `ExecutionEvent`: internal discriminated union (domain model) and external output record (output contract). Same name, incompatible shapes | Domain model §4 footnote, output contract §6 | Low — implementation risk only; rename internal union to `InternalExecutionEvent` when building |
| A6 | `ISignalRejectionWriter` call site — Phase 7 is documented as the caller, but no Phase 7 component is explicitly named as owning this responsibility | Integration map §3, Phase 6 audit M1 | Low — known from audit; must be assigned to a specific Phase 7 component during module design |

---

## 3. Missing Dependencies from Phase 5 / Phase 6

| # | Missing item | Owned by | Phase 7 blocked? |
|---|---|---|---|
| D1 | `account_id` resolver — no contract, no interface, no owner | Undeclared | **Yes** — `TradeIntent.account_id` cannot be populated without it |
| D2 | `PortfolioSnapshot` type definition and builder/cache | Undeclared (upstream of Phase 6 boundary) | No (Phase 7 doesn't call `evaluate()`) — but Phase 6 cannot be invoked without it; Phase 7 inherits a latent gap |
| D3 | `signal_st` DB enum amendment — enum missing `approved`/`suppressed`; affects `ISignalRejectionWriter` write path | Phase 3 DB migration | **Yes** — Phase 7's one sanctioned cross-phase write (`REJECTED` → `markRejected()`) fails at DB layer if enum not amended |
| D4 | `corporate_events` table — doesn't exist in Phase 3 migrations 001–019; Phase 6's Stage 5 EventRiskChecker depends on it | Phase 3 DB migration | Indirect — if Stage 5 can't run, Phase 6 can never reach `APPROVED`; Phase 7 receives no approved intents for affected signals |
| D5 | `RiskConfig`/`SwingRiskConfig` sourcing — used in 6+ Phase 6 interfaces, never typed, never linked to `risk_limits` table or any config provider | Phase 6 internal | No direct Phase 7 block — but every `TradeApprovalResult` Phase 7 consumes was produced under uncontracted config |
| D6 | `SignalFeatures` sub-field contract — Phase 6 reads `regime_confidence`/`indicators_snapshot.atr`/`regime` from an unversioned JSONB field; if Phase 5D changes internals, Phase 6 risk decisions silently break | Phase 5D/Phase 6 (M2 from Phase 6 audit) | Indirect — same as D4, Phase 7 inherits whatever Phase 6 produced |

---

## 4. Risks Before Implementation

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Duplicate order execution in live mode | Low (design guards exist) but **catastrophic if hit** | Real capital loss | Never implement without all three idempotency layers (key stability + single in-flight + mandatory reconciliation) active simultaneously. No shortcutting any one of them even in staging. |
| R2 | `account_id` gap causes execution assigned to wrong account or not at all | High likelihood (the gap is confirmed open) | Silent mis-assignment, wrong capital pool, regulatory exposure | Block implementation of `TradeIntent` creation until D1 is resolved. Do not stub `account_id` as empty string or a global default. |
| R3 | `signal_st` enum mismatch (D3) causes `ISignalRejectionWriter` to throw at DB layer | High likelihood (the enum mismatch is confirmed) | `REJECTED` signals never get written back to Phase 5; Phase 5's signal state machine stalls silently | DB migration adding `approved`/`suppressed` to enum must land before any live Phase 7 path executes. Verify in paper mode first. |
| R4 | `corporate_events` absence (D4) causes Phase 6 Stage 5 to hard-fail at runtime for every signal | High likelihood | Phase 7 receives no `APPROVED` verdicts for any signal if Stage 5 throws uncaught | Phase 6 must verify Stage 5 degrades gracefully (skip-and-pass or skip-and-warn) when table is absent. Not Phase 7's problem to solve, but Phase 7 is the one silently starved if it isn't. |
| R5 | `MarketState` untyped string (A2) causes Phase 9 to fail on pattern match at startup | Low likelihood (only hits when Phase 9 built) | Phase 9 analysis broken for regime-conditional logic | Define `MarketState` as a proper enum now, before Phase 9 design begins. Low cost to fix during Phase 7 schema pass. |
| R6 | Paper mode not wired to same state machine as live mode | Medium likelihood (easy shortcut to take under delivery pressure) | Paper results non-representative; bugs not caught before live | `PaperBrokerAdapter` must exercise the full lifecycle state machine, including retry paths, ambiguous ack paths, and partial fills. If paper bypasses the state machine, it gives false confidence. |
| R7 | `ExecutionEvent` name collision (A5) causes wrong type imported in Phase 9 | Medium likelihood | Phase 9 reads internal event type expecting output contract shape; silent data shape mismatch | Rename internal union **before first line of implementation code**. Cheap to do now, expensive to rename after a codebase exists. |
| R8 | `ISignalRejectionWriter` call site unassigned (A6) causes rejection write to simply never happen | Medium likelihood | `signals.features.risk_rejection` never populated; Phase 5 backtesting and learning loops missing a key signal outcome | Assign ownership to a specific named Phase 7 component in the module design pass. |

---

## 5. Summary

| Area | Status |
|---|---|
| Signal isolation | ✅ Clean |
| Risk logic isolation | ✅ Clean |
| Idempotency | ✅ Structurally guaranteed |
| Traceability | ✅ End-to-end key chain defined |
| Dual-mode (paper/live) | ✅ First-class in interface |
| `account_id` | ❌ Open — blocks implementation |
| DB enum (`signal_st`) | ❌ Open — blocks rejection write path |
| `corporate_events` | ❌ Open — Phase 6 Stage 5 non-functional |
| `PortfolioSnapshot` | ⚠️ Upstream gap, not a direct Phase 7 block |
| Type name collision | ⚠️ Must fix before code is written |

Phase 7 design is architecturally sound. Three hard blockers (A1/D1, D3, D4) must be resolved before implementation begins. The remaining gaps are flagged, not hidden.
