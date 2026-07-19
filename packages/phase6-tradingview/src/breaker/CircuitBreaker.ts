/**
 * packages/phase6-tradingview/src/breaker/CircuitBreaker.ts
 * Artha AI — Phase 6 Risk Engine
 *
 * A simple armed/disarmed circuit breaker.
 * When tripped, all trade approvals return REJECTED immediately.
 *
 * Trip triggers (called by Phase 9 safety layer or monitor):
 *   - Consecutive losing trades exceeding threshold
 *   - Daily DD limit hit at account level
 *   - Manual override by operator
 */

export type CircuitBreakerState = 'ARMED' | 'TRIPPED' | 'MANUAL_HOLD';

export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  reason?: string;
  tripped_at?: Date;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'ARMED';
  private reason?: string;
  private tripped_at?: Date;

  isArmed(): boolean {
    return this.state === 'ARMED';
  }

  trip(reason: string): void {
    this.state = 'TRIPPED';
    this.reason = reason;
    this.tripped_at = new Date();
  }

  hold(reason: string): void {
    this.state = 'MANUAL_HOLD';
    this.reason = reason;
    this.tripped_at = new Date();
  }

  reset(): void {
    this.state = 'ARMED';
    this.reason = undefined;
    this.tripped_at = undefined;
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      reason: this.reason,
      tripped_at: this.tripped_at,
    };
  }
}
