# Gap: `IModelVersionRepository` missing key-history query

`IModelRegistry.getHistory(model_key)` (contracts §3.5) requires "all ModelVersions
for the given ModelKey, ordered by trained_at DESC." `IModelVersionRepository`
(contracts §4.2) exposes no method to query by `ModelKey` across all statuses —
only `findById`, `findCurrent(model_key)` (CURRENT only), `findAllForRun(training_run_id)`,
and `findAllCurrentForStrategyRun(strategy_run_id)`.

`phase8-persistence-design-v1.md` §4.2 already declares the index this needs:
`idx_model_versions_key_history — (model_key_hash, trained_at DESC) — getHistory()`.
The index was designed for; the interface method to use it was never added.

Additive fix (no existing method touched):

```typescript
// Add to IModelVersionRepository (contracts §4.2)

/**
 * Returns all ModelVersions for the given ModelKey (any status), ordered by
 * trained_at DESC. Backs IModelRegistry.getHistory(). Served by
 * idx_model_versions_key_history (model_key_hash, trained_at DESC).
 */
findHistoryByModelKey(model_key: ModelKey): Promise<ModelVersionDTO[]>;
```

`ModelRegistry.ts` below assumes this method exists on the injected
`IModelVersionRepository` implementation. If Milestone 1's repository
implementation predates this note, add the one method above to
`ModelVersionRepository.ts` (Step 4 deliverable) — it's a single indexed
SELECT, same shape as `findAllForRun`.
