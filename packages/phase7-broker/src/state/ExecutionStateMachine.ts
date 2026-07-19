/**
 * packages/phase7-broker/src/state/ExecutionStateMachine.ts
 * Artha AI — Phase 7 Execution Lifecycle State Machine
 *
 * Implements the locked six-state execution lifecycle:
 *   CREATED ──► SENT_TO_BROKER ──► PARTIALLY_FILLED ──► FILLED
 *      │            │                  │
 *      │            ├──► REJECTED      ├──► CANCELLED
 *      │            └──► CANCELLED     └──► CANCELLED
 *      └──► REJECTED/CANCELLED
 */

import { ExecutionLifecycleStatus } from '../types/domain';

export class ExecutionStateMachine {
  private currentState: ExecutionLifecycleStatus = 'CREATED';

  constructor(initialState: ExecutionLifecycleStatus = 'CREATED') {
    this.currentState = initialState;
  }

  getState(): ExecutionLifecycleStatus {
    return this.currentState;
  }

  transitionTo(nextState: ExecutionLifecycleStatus): void {
    if (this.currentState === nextState) return;

    if (this.isValidTransition(this.currentState, nextState)) {
      this.currentState = nextState;
    } else {
      throw new Error(`Invalid transition from ${this.currentState} to ${nextState}`);
    }
  }

  private isValidTransition(from: ExecutionLifecycleStatus, to: ExecutionLifecycleStatus): boolean {
    switch (from) {
      case 'CREATED':
        return to === 'SENT_TO_BROKER' || to === 'REJECTED' || to === 'CANCELLED';

      case 'SENT_TO_BROKER':
        return (
          to === 'PARTIALLY_FILLED' ||
          to === 'FILLED' ||
          to === 'REJECTED' ||
          to === 'CANCELLED'
        );

      case 'PARTIALLY_FILLED':
        return to === 'PARTIALLY_FILLED' || to === 'FILLED' || to === 'CANCELLED';

      case 'FILLED':
        return false; // Terminal state

      case 'REJECTED':
        // A rejected order can transition back to SENT_TO_BROKER on a retry attempt
        return to === 'SENT_TO_BROKER';

      case 'CANCELLED':
        return false; // Terminal state

      default:
        return false;
    }
  }
}
