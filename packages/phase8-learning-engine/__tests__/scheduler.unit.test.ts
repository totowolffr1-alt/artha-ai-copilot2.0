/**
 * phase8/__tests__/scheduler.unit.test.ts
 * Covers roadmap Step 16 unit test spec exactly.
 */
import { EodTrainingJob } from '../scheduler/EodTrainingJob';
import { PreMarketInjectionJob } from '../scheduler/PreMarketInjectionJob';
import { Phase8StartupCheck } from '../scheduler/Phase8StartupCheck';
import { ConcurrentTrainingRunError, InjectionTimeoutError } from '../errors/Phase8Error';

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('EodTrainingJob', () => {
  it('logs ConcurrentTrainingRunError as a warning and does not rethrow', async () => {
    const logger = makeLogger();
    const learningEngine = {
      triggerEodRun: jest
        .fn()
        .mockRejectedValue(new ConcurrentTrainingRunError('strat-1', 'existing-run' as any, 'INGESTING' as any)),
      injectIntoPhase5: jest.fn(),
      hasReadyModel: jest.fn(),
    };
    const job = new EodTrainingJob(learningEngine as any, logger as any);

    await expect(job.run('strat-1', new Date())).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs unexpected errors and does not rethrow (pg_cron must not error)', async () => {
    const logger = makeLogger();
    const learningEngine = {
      triggerEodRun: jest.fn().mockRejectedValue(new Error('db unreachable')),
      injectIntoPhase5: jest.fn(),
      hasReadyModel: jest.fn(),
    };
    const job = new EodTrainingJob(learningEngine as any, logger as any);

    await expect(job.run('strat-1', new Date())).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('PreMarketInjectionJob', () => {
  it('logs InjectionTimeoutError and continues without rethrowing', async () => {
    const logger = makeLogger();
    const learningEngine = {
      triggerEodRun: jest.fn(),
      injectIntoPhase5: jest.fn().mockRejectedValue(new InjectionTimeoutError('strat-1', 5000)),
      hasReadyModel: jest.fn(),
    };
    const job = new PreMarketInjectionJob(learningEngine as any, logger as any);

    await expect(
      job.run('strat-1', { setQualityModel: jest.fn() }, { setWinRateProvider: jest.fn() })
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('Phase8StartupCheck', () => {
  it('marks an in-progress run FAILED(UNKNOWN) and logs an alert', async () => {
    const logger = makeLogger();
    const trainingRunRepo = {
      save: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findLatestCompleted: jest.fn(),
      findInProgress: jest.fn().mockResolvedValue({ training_run_id: 'run-1', status: 'INGESTING' }),
    };
    const injectionJob = { run: jest.fn() };
    const check = new Phase8StartupCheck(trainingRunRepo as any, injectionJob as any, logger as any);

    await check.run('strat-1', { setQualityModel: jest.fn() }, { setWinRateProvider: jest.fn() });

    expect(trainingRunRepo.updateStatus).toHaveBeenCalledWith(
      'run-1',
      'FAILED',
      expect.objectContaining({ failure_reason: 'UNKNOWN' })
    );
    expect(logger.error).toHaveBeenCalled();
    expect(injectionJob.run).not.toHaveBeenCalled();
  });

  it('proceeds to injection check when no in-progress run is found', async () => {
    const logger = makeLogger();
    const trainingRunRepo = {
      save: jest.fn(),
      updateStatus: jest.fn(),
      findById: jest.fn(),
      findLatestCompleted: jest.fn().mockResolvedValue({ training_run_id: 'run-2', status: 'TRAINED' }),
      findInProgress: jest.fn().mockResolvedValue(null),
    };
    const injectionJob = { run: jest.fn().mockResolvedValue(undefined) };
    const check = new Phase8StartupCheck(trainingRunRepo as any, injectionJob as any, logger as any);

    await check.run('strat-1', { setQualityModel: jest.fn() }, { setWinRateProvider: jest.fn() });

    expect(injectionJob.run).toHaveBeenCalledWith(
      'strat-1',
      expect.anything(),
      expect.anything()
    );
  });

  it('does not attempt injection when latest completed run is not TRAINED', async () => {
    const logger = makeLogger();
    const trainingRunRepo = {
      save: jest.fn(),
      updateStatus: jest.fn(),
      findById: jest.fn(),
      findLatestCompleted: jest.fn().mockResolvedValue({ training_run_id: 'run-3', status: 'INJECTED' }),
      findInProgress: jest.fn().mockResolvedValue(null),
    };
    const injectionJob = { run: jest.fn() };
    const check = new Phase8StartupCheck(trainingRunRepo as any, injectionJob as any, logger as any);

    await check.run('strat-1', { setQualityModel: jest.fn() }, { setWinRateProvider: jest.fn() });

    expect(injectionJob.run).not.toHaveBeenCalled();
  });
});
