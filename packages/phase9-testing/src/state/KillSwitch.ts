/**
 * packages/phase9-testing/src/state/KillSwitch.ts
 * Artha AI — Phase 9 KillSwitch
 *
 * Emergency stop mechanism. Gates Phase 8 learning and Phase 7 order submissions.
 */

import { KillSwitchState, IAlertNotifier } from '../types';

export class KillSwitch {
  private currentState: KillSwitchState = 'ACTIVE';

  constructor(
    private readonly alertNotifier: IAlertNotifier
  ) {}

  async getKillSwitchState(): Promise<KillSwitchState> {
    return this.currentState;
  }

  async transition(newState: KillSwitchState, reason?: string): Promise<void> {
    if (this.currentState === newState) return;

    this.currentState = newState;
    if (newState === 'EMERGENCY_STOP') {
      await this.alertNotifier.sendAlert(`EMERGENCY STOP TRIGGERED: ${reason ?? 'Unknown safety breach'}`, {
        ts: new Date(),
        state: 'EMERGENCY_STOP'
      });
    } else {
      await this.alertNotifier.sendAlert(`System reset to ACTIVE. Trading resumed.`, {
        ts: new Date(),
        state: 'ACTIVE'
      });
    }
  }
}
