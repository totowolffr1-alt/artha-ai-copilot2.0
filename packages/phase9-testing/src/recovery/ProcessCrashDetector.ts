/**
 * packages/phase9-testing/src/recovery/ProcessCrashDetector.ts
 * Artha AI — Phase 9 Process Crash Detector
 *
 * Implements crash recovery rules (B2):
 *   - Checks rotation progress on startup.
 *   - Idempotently re-applies rotation/hydration to avoid ghost exposures.
 */

import { SessionRotationSerializer } from '../session/SessionRotationSerializer';
import { IAlertNotifier } from '../types';

export class ProcessCrashDetector {
  constructor(
    private readonly serializer: SessionRotationSerializer,
    private readonly alertNotifier: IAlertNotifier,
    // Callbacks to perform reconciliation / clean recovery
    private readonly recoverRotationState: () => Promise<void>
  ) {}

  /**
   * Scan system state at startup to check if a crash occurred
   * during an active session rotation.
   */
  async scanAndRecover(): Promise<void> {
    const crashedDuringRotation = this.serializer.isRotationInProgress();

    if (crashedDuringRotation) {
      await this.alertNotifier.sendAlert('CRITICAL: System crash detected during session rotation. Initiating recovery...');
      try {
        // Idempotently re-apply the rotation logic
        await this.recoverRotationState();
        await this.alertNotifier.sendAlert('SUCCESS: Session rotation state successfully recovered. Ghost exposure cleared.');
      } catch (err: any) {
        await this.alertNotifier.sendAlert(`CRITICAL: Session rotation recovery failed: ${err.message}. Manual intervention required.`);
        throw err;
      }
    }
  }
}
