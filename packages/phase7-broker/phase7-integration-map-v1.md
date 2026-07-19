# Artha AI — Phase 7: System Integration Map v1

Consolidates every boundary established across Phase 5, Phase 6, and Phase 7 into one map. Nothing redesigned here — this is the assembled picture of decisions already made in the prior documents.

---

## 1. Flow

```
SignalEvent (Phase 5)
   │  read-only — frozen 13 fields + uncontracted SignalFeatures sub-fields
   ▼
RiskDecision (Phase 6)
   │  read-only — decision-only, no instrument/price fields
   ▼
TradeIntent (Phase 7)
   │  Phase 7-internal — fusion of TradeApprovalResult + SignalEvent, keyed by signal_id
   ▼
ExecutionEvent (Phase 7 output)
```

Naming note: `RiskDecision` is the diagram label for Phase 6's output. The concrete type is `TradeApprovalResult` (defined in the Phase 6 design doc) — `RiskDecision` isn't a separate type, just a readable name for the arrow.

---

## 2. Read Permissions

| Phase | May read | May NOT read |
|---|---|---|
| **Phase 5** | `candles`, `symbols`, `corporate_events`*, market data feeds, its own `signals`/`learning_records` | Phase 6 outputs (`risk_snapshots`, `exposure_log`, etc.), Phase 7 outputs (`ExecutionEvent`/`ExecutionResult`), any broker/execution state |
| **Phase 6** | `SignalEvent` (frozen 13 fields, read-only) + `SignalFeatures` sub-fields it already depends on (`regime`, `regime_confidence`, `indicators_snapshot.atr`) + `PortfolioSnapshot`** + `candles`/`symbols`/`strategy_runs`/`signals` | Phase 7 execution state (`OrderRequest`, `ExecutionEvent`, `FillEvent`, broker responses) — `evaluate()` has zero awareness execution exists, by design. Phase 5 internals beyond the frozen contract (`SignalEngine`/`RegimeEngine` logic itself) |
| **Phase 7** | `TradeApprovalResult` (Phase 6 output, read-only) + `SignalEvent` (Phase 5 output, read-only, via `signal_id` join) — **these two only** | Phase 6's intermediate stage results (`RiskValidationResult`, individual stage checkers — Phase 7 only ever sees the final verdict). Phase 6-owned tables (`risk_snapshots`, `exposure_log`, `drawdown_log`, `market_status`, `sebi_actions`). `SignalFeatures` internals beyond what's already surfaced in `SignalEvent` — Phase 7 has no reason to read `regime_confidence`/`atr` directly, that's already Phase 6's job |

\* still flagged missing from Phase 3 schema. \*\* still flagged undefined as a type, upstream gap.

---

## 3. Write Permissions

| Phase | May write | Mechanism |
|---|---|---|
| **Phase 5** | `signals`, `signals.features` (`SignalFeatures`), `learning_records` | Directly, via its own `ISignalWriter`/`ISignalRejectionWriter` — Phase 5 owns these writers; nobody else writes the underlying columns |
| **Phase 6** | `risk_snapshots`, `exposure_log`, `drawdown_log`, `market_status`, `sebi_actions` | Directly — Phase 6-owned tables exclusively. Never touches `signals` or `SignalFeatures` |
| **Phase 7** | `OrderRequest`, internal `ExecutionEvent`/`FillEvent`/`RetryState`, `BrokerResponse` records, the output contract (`ExecutionEvent`/`ExecutionResult`) | Directly, within its own domain only |

**The one sanctioned cross-phase write:** Phase 7 calls `ISignalRejectionWriter.markRejected(signal_id, reasons)` when `TradeApprovalResult.decision === 'REJECTED'`. This is a call into Phase 5's own interface — Phase 7 never touches `signals.features.risk_rejection` itself; Phase 5's own writer code performs the mutation. This is the single boundary crossing in the entire system, already identified in the Phase 6-vs-Phase 5 audit (finding M1), and it remains the only one permitted anywhere.

---

## 4. Forbidden Cross-Phase Mutations

| Forbidden | Why |
|---|---|
| Phase 7 writes directly to `signals` / `SignalFeatures` | Only path in is `ISignalRejectionWriter`, and only for `REJECTED`. No other field, no other status, no direct column access — ever. |
| Phase 7 writes to `risk_snapshots`/`exposure_log`/`drawdown_log`/`market_status`/`sebi_actions` | Phase 6-owned. Phase 7 has no business in Phase 6's risk bookkeeping. |
| Phase 7 calls `SignalEngine`/`RegimeEngine`/`KellyCalculator`/`RiskValidationPipeline`/`ConvictionScorer` or any other Phase 5/6 internal component | Phase 7 consumes finalized *output objects* only (`SignalEvent`, `TradeApprovalResult`), never the logic that produced them. |
| Phase 7 recomputes or overrides any Phase 6 decision field (`confidence`, `suggestedSize`, `decision`, `reasons`) | Phase 7 has no risk authority. If it disagrees, it can fail to execute — it cannot substitute its own judgment for Phase 6's. |
| Phase 7 mutates `SignalEvent` fields, even post-execution (e.g. "correcting" `stop_loss` after seeing fill price) | New information belongs to a new signal cycle — Phase 5's job, not a retroactive edit of one that already fired. |
| Phase 6 writes to `signals`/`SignalFeatures` directly | Already confirmed clean in the audit — restated here as a hard rule that Phase 7's existence doesn't loosen. |
| Phase 6 calls into Phase 7 | Phase 6 has zero knowledge Phase 7 exists. `evaluate()` is zero-I/O and imports nothing execution-related. The arrow only ever points one way. |
| Phase 5 reads or reacts to Phase 7 execution outcomes mid-cycle | Phase 5 is execution-agnostic by design — that's what keeps it backtestable. Feeding fill outcomes back into signal generation is a learning-loop concern (Phase 9, not built, not Phase 7's job to wire). |

---

## 5. Explicit Statements

**Phase 7 cannot modify Phase 5 or Phase 6 data.** The one exception (§3, `ISignalRejectionWriter`) is not a counterexample — it's a call into Phase 5's own interface, and the actual write is performed by Phase 5's code, not Phase 7's. Phase 7 never holds a direct handle to any Phase 5 or Phase 6 table.

**Phase 7 is purely an execution layer.** It does not generate signals, does not evaluate risk, does not score conviction, does not decide approve/reject, does not learn. All of that is already decided by the time a `TradeIntent` exists. Phase 7's entire domain is: did the broker execute this, how, when, at what price, with what slippage — and recording that truthfully and traceably. Nothing upstream of that decision is Phase 7's to touch.

---

## 6. Structural Gaps Carried Forward (not solved here)

- `account_id` resolution — still missing upstream. No phase currently has a contract for which account a decision applies to; this map inherits that gap rather than papering over it.
- `signal_st` enum mismatch (Phase 5 vs Phase 3) — directly affects Phase 7's only sanctioned write path. If the enum can't hold the values Phase 5 needs, `ISignalRejectionWriter` itself is standing on a broken table.
- `RiskConfig`/`SwingRiskConfig` sourcing into Phase 6 — doesn't touch Phase 7 directly, but sits upstream of every `RiskDecision` Phase 7 consumes. A defect there propagates silently into every `TradeIntent`.
