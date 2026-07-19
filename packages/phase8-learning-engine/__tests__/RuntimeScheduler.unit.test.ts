/**
 * phase8/__tests__/RuntimeScheduler.unit.test.ts
 * Tests the IST-window tick logic in isolation via jest fake timers +
 * a controlled system clock, rather than waiting on real wall-clock time.
 */
import { RuntimeScheduler } from '../scheduler/RuntimeScheduler';

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('RuntimeScheduler', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires EodTrainingJob at 18:30 IST on a weekday and only once for that minute', async () => {
    // 18:30 IST == 13:00 UTC. Pick a known weekday (Wed 2026-07-08).
    const utcAt1300 = new Date('2026-07-08T13:00:00.000Z');
    jest.useFakeTimers().setSystemTime(utcAt1300);

    const eodJob = { run: jest.fn().mockResolvedValue(undefined) };
    const injectionJob = { run: jest.fn().mockResolvedValue(undefined) };
    const startupCheck = { run: jest.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();

    const scheduler = new RuntimeScheduler(
      eodJob as any,
      injectionJob as any,
      startupCheck as any,
      ['strat-1'],
      new Map([['strat-1', { signalEngine: { setQualityModel: jest.fn() }, kellyCalculator: { setWinRateProvider: jest.fn() } }]]),
      logger as any
    );

    await scheduler.start();
    await jest.advanceTimersByTimeAsync(60_000); // one tick

    expect(eodJob.run).toHaveBeenCalledTimes(1);
    expect(eodJob.run).toHaveBeenCalledWith('strat-1', expect.any(Date), 'PG_CRON');

    // A second tick within the same minute window must not double-fire.
    await jest.advanceTimersByTimeAsync(60_000);
    // 13:01 UTC now — no longer the trigger minute, still expect exactly 1 call total.
    expect(eodJob.run).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('fires PreMarketInjectionJob at 08:45 IST on a weekday', async () => {
    // 08:45 IST == 03:15 UTC.
    const utcAt0315 = new Date('2026-07-08T03:15:00.000Z');
    jest.useFakeTimers().setSystemTime(utcAt0315);

    const eodJob = { run: jest.fn() };
    const injectionJob = { run: jest.fn().mockResolvedValue(undefined) };
    const startupCheck = { run: jest.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();
    const refs = { signalEngine: { setQualityModel: jest.fn() }, kellyCalculator: { setWinRateProvider: jest.fn() } };

    const scheduler = new RuntimeScheduler(
      eodJob as any,
      injectionJob as any,
      startupCheck as any,
      ['strat-1'],
      new Map([['strat-1', refs]]),
      logger as any
    );

    await scheduler.start();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(injectionJob.run).toHaveBeenCalledWith('strat-1', refs.signalEngine, refs.kellyCalculator);
    scheduler.stop();
  });

  it('does not fire on a weekend even at 18:30 IST', async () => {
    // Saturday 2026-07-11, 13:00 UTC = 18:30 IST.
    const utcSaturday = new Date('2026-07-11T13:00:00.000Z');
    jest.useFakeTimers().setSystemTime(utcSaturday);

    const eodJob = { run: jest.fn() };
    const injectionJob = { run: jest.fn() };
    const startupCheck = { run: jest.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();

    const scheduler = new RuntimeScheduler(
      eodJob as any,
      injectionJob as any,
      startupCheck as any,
      ['strat-1'],
      new Map([['strat-1', { signalEngine: { setQualityModel: jest.fn() }, kellyCalculator: { setWinRateProvider: jest.fn() } }]]),
      logger as any
    );

    await scheduler.start();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(eodJob.run).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('runs Phase8StartupCheck once per strategy_run_id on start()', async () => {
    const eodJob = { run: jest.fn() };
    const injectionJob = { run: jest.fn() };
    const startupCheck = { run: jest.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();
    const refs = { signalEngine: { setQualityModel: jest.fn() }, kellyCalculator: { setWinRateProvider: jest.fn() } };

    const scheduler = new RuntimeScheduler(
      eodJob as any,
      injectionJob as any,
      startupCheck as any,
      ['strat-1', 'strat-2'],
      new Map([
        ['strat-1', refs],
        ['strat-2', refs],
      ]),
      logger as any
    );

    await scheduler.start();

    expect(startupCheck.run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});
