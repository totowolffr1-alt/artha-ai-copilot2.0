/**
 * packages/phase10-copilot-intelligence/src/__tests__/LearningScheduler.test.ts
 * Artha AI — Phase 10 Learning Scheduler Tests
 */

import { LearningScheduler } from '../engine/LearningScheduler';
import { MarketHoursGuard } from '../guards/MarketHoursGuard';

describe('LearningScheduler', () => {
  const mockTraining = jest.fn().mockResolvedValue(undefined);

  test('does not trigger training when market is open', async () => {
    const mockGuard = {
      isMarketOpen: () => true
    } as any as MarketHoursGuard;

    const scheduler = new LearningScheduler(mockGuard, mockTraining);
    
    // Trigger check
    await (scheduler as any).checkAndSchedule();

    expect(mockTraining).not.toHaveBeenCalled();
    expect(scheduler.isTrainingActive()).toBe(false);
  });

  test('triggers training daily between 16:00 and 16:15 IST when market is closed', async () => {
    const mockGuard = {
      isMarketOpen: () => false
    } as any as MarketHoursGuard;

    const scheduler = new LearningScheduler(mockGuard, mockTraining);

    // Mock Date.prototype.toLocaleString to return a specific hour (4:05 PM IST)
    const originalToLocaleString = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = jest.fn().mockReturnValue('19/07/2026, 16:05:00');

    try {
      await (scheduler as any).checkAndSchedule();
      expect(mockTraining).toHaveBeenCalled();
    } finally {
      Date.prototype.toLocaleString = originalToLocaleString;
    }
  });

  test('does not trigger training at other times when market is closed', async () => {
    const mockGuard = {
      isMarketOpen: () => false
    } as any as MarketHoursGuard;

    const scheduler = new LearningScheduler(mockGuard, mockTraining);

    // Mock Date to 2:00 PM (14:00) IST
    const originalToLocaleString = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = jest.fn().mockReturnValue('19/07/2026, 14:00:00');

    try {
      mockTraining.mockClear();
      await (scheduler as any).checkAndSchedule();
      expect(mockTraining).not.toHaveBeenCalled();
    } finally {
      Date.prototype.toLocaleString = originalToLocaleString;
    }
  });
});
