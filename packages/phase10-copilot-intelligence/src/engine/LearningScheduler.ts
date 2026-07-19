/**
 * packages/phase10-copilot-intelligence/src/engine/LearningScheduler.ts
 * Artha AI — Phase 10 Parallel Learning Scheduler
 *
 * Implements the following rule:
 * - Suspends training during active market hours (09:15 - 15:30 IST) to focus on performance mode.
 * - Schedules and runs machine learning retraining sessions outside market hours (e.g. 16:00 IST).
 */

import { MarketHoursGuard } from '../guards/MarketHoursGuard';

export class LearningScheduler {
  private trainingInProgress = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly hoursGuard: MarketHoursGuard,
    /** Callback to execute the actual machine learning training process */
    private readonly runTraining: () => Promise<void>
  ) {}

  /**
   * Starts the background scheduler that monitors market hours.
   * Checks every minute.
   */
  start(): void {
    if (this.timer) return;

    console.log('[LearningScheduler] Background scheduler started.');
    
    // Check every minute
    this.timer = setInterval(async () => {
      await this.checkAndSchedule();
    }, 60000);

    // Run an initial check on boot
    this.checkAndSchedule().catch(() => {});
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[LearningScheduler] Background scheduler stopped.');
  }

  /**
   * Checks current market state and triggers training if market is closed.
   */
  private async checkAndSchedule(): Promise<void> {
    const isMarketOpen = this.hoursGuard.isMarketOpen(new Date());

    if (isMarketOpen) {
      if (this.trainingInProgress) {
        console.warn('[LearningScheduler] Market is OPEN! Forcing training to pause/abort to free up CPU resources.');
        this.trainingInProgress = false;
      }
      return; // Free CPU entirely for execution hot-path
    }

    // Market is closed - check if we should retrain
    if (!this.trainingInProgress) {
      const now = new Date();
      // Retrain daily at 4:00 PM IST (16:00)
      const istString = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const istDate = new Date(istString);
      const hour = istDate.getHours();
      const minute = istDate.getMinutes();

      // Trigger once daily in the 4:00 PM - 4:15 PM IST window
      if (hour === 16 && minute >= 0 && minute <= 15) {
        console.log('[LearningScheduler] Market is closed. Starting parallel training run for today\'s paper trades...');
        this.trainingInProgress = true;
        try {
          await this.runTraining();
          console.log('[LearningScheduler] Parallel training completed successfully.');
        } catch (err: any) {
          console.error('[LearningScheduler] Error during training execution:', err.message);
        } finally {
          this.trainingInProgress = false;
        }
      }
    }
  }

  isTrainingActive(): boolean {
    return this.trainingInProgress;
  }
}
