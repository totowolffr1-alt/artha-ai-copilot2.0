/**
 * packages/phase9-testing/src/recovery/SentinelTransaction.ts
 * Artha AI — Phase 9 Sentinel Startup Transaction
 *
 * Implements H6 safety rules:
 *   - Runs startup validation query.
 *   - Max 3 retries with 2s/4s backoff.
 *   - Writes sentinel abort file and terminates process.exit(1) on exhaustion.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IAlertNotifier } from '../types';

export class SentinelTransaction {
  constructor(
    private readonly alertNotifier: IAlertNotifier,
    // Database query execution mock/callback
    private readonly executeQuery: () => Promise<void>,
    private readonly maxRetries: number = 3
  ) {}

  /**
   * Run the startup sentinel transaction.
   * Retries on database connection failure with exponential backoff.
   */
  async runStartupCheck(): Promise<void> {
    let attempt = 1;
    let delay = 2000; // 2 seconds initial backoff

    while (attempt <= this.maxRetries) {
      try {
        await this.executeQuery();
        return; // Success!
      } catch (err: any) {
        await this.alertNotifier.sendAlert(`Sentinel transaction attempt ${attempt} failed: ${err.message}.`);

        if (attempt === this.maxRetries) {
          break; // Exhausted
        }

        // Wait with backoff (2s, 4s, etc.)
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        attempt++;
      }
    }

    // Exhausted retries! Write sentinel file and terminate process
    this.writeAbortSentinel(`Sentinel transaction failed after ${this.maxRetries} attempts.`);
    await this.alertNotifier.sendAlert(`CRITICAL: Sentinel transaction exhausted. Writing abort sentinel and calling process.exit(1).`);
    
    // We mock process.exit for testing so it doesn't terminate the jest test suite runner!
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    } else {
      throw new Error('PROCESS_EXIT_SIMULATED');
    }
  }

  private writeAbortSentinel(reason: string): void {
    const content = JSON.stringify({
      reason,
      timestamp: new Date(),
    }, null, 2);

    // Write to /tmp/artha_startup_abort
    const tmpPath = '/tmp/artha_startup_abort';
    try {
      const dir = path.dirname(tmpPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(tmpPath, content);
    } catch (err: any) {
      // Fallback to OS temp dir if writing to root /tmp fails on Windows
      try {
        const winTmp = path.join(os.tmpdir(), 'artha_startup_abort');
        fs.writeFileSync(winTmp, content);
      } catch (inner) {
        console.error('Failed to write abort sentinel:', inner);
      }
    }
  }
}
