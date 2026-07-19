/**
 * phase8/services/ISystemStateReader.ts
 * See ISystemStateReader.PATCH.md — Phase 9 defines no read contract for
 * KillSwitch state (audit B-07). This is the minimal Phase-8-local interface
 * InjectionOrchestrator depends on instead of reaching into Phase 9 directly.
 */
export type KillSwitchState = 'ACTIVE' | 'EMERGENCY_STOP';

export interface ISystemStateReader {
  /** Reads Phase 9's current KillSwitch state from system_state (key: 'current_session'). */
  getKillSwitchState(): Promise<KillSwitchState>;
}
