# Gap: no read contract for Phase 9's KillSwitch state (audit B-07)

`phase8-runtime-flow-v1.md` §9.3 and the roadmap's Step 14 acceptance criteria
both require `InjectionOrchestrator.deliver()` to gate on KillSwitch state
(read `system_state`, skip injection if `EMERGENCY_STOP`). `phase8-readiness-
audit-v1.md` finding B-07 confirms: Phase 9 writes `system_state` but "no
`IKillSwitch` read interface is defined in Phase 9's patch document (only
`transition()` write is documented). Phase 8 has no contract to read from."

B-07 is a separate, lower-severity audit finding — not one of the three closed
implementation blockers (A-01/A-02/A-03) named for this round. It's flagged
here rather than silently worked around, per the same principle applied to
the two DTO/repository gaps above.

Since Phase 8 has no Phase-9-owned interface to import, `InjectionOrchestrator`
below takes a minimal Phase-8-local interface via constructor injection —
consistent with the DI pattern used for every other dependency, and isolating
the one place this assumption lives:

```typescript
export interface ISystemStateReader {
  /** Returns Phase 9's current KillSwitch state, read from system_state. */
  getKillSwitchState(): Promise<'ACTIVE' | 'EMERGENCY_STOP'>;
}
```

The concrete implementation (a `system_state` table read keyed on
`current_session`, per the roadmap's Step 14 test description) is Milestone
4's infrastructure wiring (Step 16, pg_cron/startup integration) — outside
this module's scope. `InjectionOrchestrator` only depends on the interface
above, not on how it's backed.
