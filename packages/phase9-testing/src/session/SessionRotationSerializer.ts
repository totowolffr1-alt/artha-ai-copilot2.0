/**
 * packages/phase9-testing/src/session/SessionRotationSerializer.ts
 * Artha AI — Phase 9 Session Rotation Serializer
 *
 * Implements H1, H2, and B2 safety rules for session transitions:
 *   - Queue cap of 5 (ROTATION_QUEUE_FULL).
 *   - Spacing interval: minimum 200ms.
 *   - Awaited drain loop & exclusive rotating flag management.
 *   - Crash recovery rotation_in_progress sentinel.
 */

export class SessionRotationSerializer {
  private queue: Array<() => Promise<void>> = [];
  private rotating = false;
  private lastRotationTime = 0;
  private rotationInProgress = false;
  /** Tracks queued + currently-executing rotations for cap enforcement. */
  private pendingCount = 0;

  constructor(
    private readonly onRotate: () => Promise<void>,
    private readonly onHydrate: () => Promise<void>
  ) {}

  /**
   * Request a session rotation. Returns a promise that resolves
   * when this rotation and its subsequent DB hydration are complete.
   */
  async requestRotation(): Promise<void> {
    const now = Date.now();

    // H1: Enforce minimum 200ms spacing
    if (now - this.lastRotationTime < 200) {
      throw new Error('ROTATION_REJECTED: Inter-rotation interval must be at least 200ms');
    }

    // H1: Enforce cap of 5 (queued + in-flight)
    if (this.pendingCount >= 5) {
      throw new Error('ROTATION_QUEUE_FULL');
    }

    this.pendingCount++;
    return new Promise<void>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          this.lastRotationTime = Date.now();

          // B2: Write rotation_in_progress sentinel BEFORE execution
          this.rotationInProgress = true;

          // Execute rotation and hydration
          await this.onRotate();
          await this.onHydrate();

          // Clear rotation sentinel AFTER successful hydration
          this.rotationInProgress = false;
          resolve();
        } catch (err: any) {
          // Keep sentinel active if crash happened during execution
          reject(err);
        } finally {
          // Always decrement regardless of success or failure
          this.pendingCount--;
        }
      });

      // H2: drainQueue is triggered and exclusive rotating flag set
      this.triggerDrain();
    });
  }

  isRotationInProgress(): boolean {
    return this.rotationInProgress;
  }

  private triggerDrain(): void {
    if (this.rotating) return;
    this.rotating = true;

    // Await drain loop asynchronously to handle trigger chain
    this.drainQueue()
      .catch(() => {})
      .finally(() => {
        this.rotating = false;
      });
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        await task();
      }
    }
  }
}
