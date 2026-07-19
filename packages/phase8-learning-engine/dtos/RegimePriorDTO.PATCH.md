# Gap: `RegimePriorDTO` (contracts §7) missing identity fields

`phase8-contracts-v1.md` §7 defines `RegimePriorDTO` as:

```typescript
export interface RegimePriorDTO {
  readonly win_rate: WinRate;
  readonly avg_return_pct: number;
  readonly avg_volatility: number;
  readonly indicator_rankings: IndicatorRanking[];
  readonly regime_fitness: RegimeFitness;
  readonly computed_at: Date;
  superseded_at: Date | null;
}
```

This has no `regime_prior_id`, `training_run_id`, `regime_label`, `symbol_id`,
`timeframe`, or `status`. Without these, `IRegimePriorUpdater.activate()` cannot
call `IRegimePriorRepository.updateStatus(regime_prior_id, ...)` or
`.findCurrent(regime_label, symbol_id, timeframe)` — the fields the repository
interface (§4.3) requires as arguments don't exist anywhere on the DTO it's
handed. `phase8-domain-model-v1.md` §2.3 lists the full `RegimePrior` entity
with exactly these fields, so this is a transcription gap between the domain
model and the contracts DTO, not an intentional omission.

Additive fix — `RegimePriorDTO` extended to match domain model §2.3 (no field
removed, six added):

```typescript
export interface RegimePriorDTO {
  readonly regime_prior_id: RegimePriorId;
  readonly training_run_id: TrainingRunId;
  readonly regime_label: string;
  readonly symbol_id: string | null;
  readonly timeframe: string;
  status: RegimePriorStatus;
  readonly win_rate: WinRate;
  readonly avg_return_pct: number;
  readonly avg_volatility: number;
  readonly indicator_rankings: IndicatorRanking[];
  readonly regime_fitness: RegimeFitness;
  readonly computed_at: Date;
  superseded_at: Date | null;
}
```

`RegimePriorUpdater.ts` below is written against this corrected shape. If
Milestone 1/2's DTO module predates this note, apply the same six-field
addition there — it is additive only, no existing consumer field changes type.
