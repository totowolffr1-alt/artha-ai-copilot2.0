/**
 * packages/phase9-testing/src/guards/SubmissionFreezeGuard.ts
 * Artha AI — Phase 9 Submission Freeze Guard
 *
 * Intercepts new order submissions (H4). Checks in-memory escrow set
 * to ensure zero DB I/O on the hot path.
 */

import { CancelledFillEscalator } from '../escalation/CancelledFillEscalator';

export class SubmissionFreezeGuard {
  /**
   * Gates order gateway entry.
   * Blocks if there is any unresolved unexpected fill in escrow.
   */
  check(): { passed: boolean; reason?: string } {
    if (CancelledFillEscalator.hasPendingEscrow()) {
      return {
        passed: false,
        reason: 'UNEXPECTED_FILL_PENDING_REVIEW',
      };
    }
    return { passed: true };
  }
}
