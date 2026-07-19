/**
 * packages/phase9-testing/src/escalation/CancelledFillEscalator.ts
 * Artha AI — Phase 9 Cancelled Fill Escalator
 *
 * Implements H4 and B3 safety rules:
 *   - DB-first write, then in-memory set update.
 *   - B3: Broker verification before overriding a rejected fill state.
 *   - Auto EMERGENCY_STOP trigger upon broker-confirmed unexpected fill.
 */

import { FillEvent } from '../../../phase7-broker/src/types/domain';
import { BrokerOrderVerifier } from '../adapters/BrokerOrderVerifier';
import { KillSwitch } from '../state/KillSwitch';
import { IAlertNotifier } from '../types';

export class CancelledFillEscalator {
  private static readonly pendingEscrowIds: Set<string> = new Set();

  constructor(
    private readonly orderVerifier: BrokerOrderVerifier,
    private readonly killSwitch:     KillSwitch,
    private readonly alertNotifier:  IAlertNotifier,
    // Database query execution mock/callback
    private readonly executeDbQuery: (query: string, params: any[]) => Promise<void>
  ) {}

  static hasPendingEscrow(): boolean {
    return CancelledFillEscalator.pendingEscrowIds.size > 0;
  }

  static clearEscrow(): void {
    CancelledFillEscalator.pendingEscrowIds.clear();
  }

  static addEscrowId(orderId: string): void {
    CancelledFillEscalator.pendingEscrowIds.add(orderId);
  }

  /**
   * Escalate an unexpected fill event. Writes to DB first,
   * then updates the in-memory set to trigger the submission freeze (H4).
   */
  async escalate(fill: FillEvent): Promise<void> {
    // 1. Write to DB (durable record first)
    await this.executeDbQuery(
      `INSERT INTO unexpected_fills (order_id, fill_event, escalated_at) VALUES ($1, $2, $3)`,
      [fill.order_request_id, JSON.stringify(fill), new Date()]
    );

    // 2. Update in-memory set
    CancelledFillEscalator.pendingEscrowIds.add(fill.order_request_id);

    await this.alertNotifier.sendAlert(`Escalated unexpected fill for order ${fill.order_request_id}. Freezing submissions.`, {
      orderId: fill.order_request_id,
      qty: fill.fill_qty,
    });
  }

  /**
   * Resolve an escalated escrow order.
   */
  async resolveEscrow(orderId: string, resolution: 'APPLIED' | 'REJECTED' | 'AUTO_ESCALATED'): Promise<void> {
    // 1. Update DB first
    await this.executeDbQuery(
      `UPDATE unexpected_fills SET resolved_at = $1, resolution = $2 WHERE order_id = $3`,
      [new Date(), resolution, orderId]
    );

    // 2. Remove from in-memory set
    CancelledFillEscalator.pendingEscrowIds.delete(orderId);

    await this.alertNotifier.sendAlert(`Escrow resolved for order ${orderId} via ${resolution}.`);
  }

  /**
   * B3 rule: verify order status at broker before allowing a REJECT/CANCEL logic override.
   * If broker confirms FILLED, triggers emergency stop.
   */
  async handleUnexpectedFillResponse(
    fill: FillEvent,
    rawBrokerOrderDetailResponse: any
  ): Promise<void> {
    const verified = this.orderVerifier.parseOrderDetail(rawBrokerOrderDetailResponse);

    if (!verified) {
      throw new Error('UNEXPECTED_FILL_VERIFICATION_FAILED: Broker order detail endpoint unavailable or returned malformed data');
    }

    if (verified.status === 'CONFIRMED_FILLED') {
      // Broker confirms it was filled! Override rejected state, escalate, and trip KillSwitch
      await this.escalate(fill);
      await this.killSwitch.transition(
        'EMERGENCY_STOP',
        `Unexpected fill confirmed complete at broker for order ${fill.order_request_id}`
      );
    } else {
      // Order was indeed cancelled/rejected at broker, this is a phantom fill notification
      await this.alertNotifier.sendAlert(`Phantom fill notification ignored for order ${fill.order_request_id} (confirmed ${verified.status} at broker)`);
    }
  }
}
