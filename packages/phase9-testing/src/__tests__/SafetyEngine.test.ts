/**
 * packages/phase9-testing/src/__tests__/SafetyEngine.test.ts
 * Artha AI — Phase 9 Unit Tests (27 tests)
 */

import { KillSwitch } from '../state/KillSwitch';
import { ConsoleNotifier } from '../types';
import { StateRestorer } from '../state/StateRestorer';
import { SessionRotationSerializer } from '../session/SessionRotationSerializer';
import { BrokerPositionAdapter } from '../adapters/BrokerPositionAdapter';
import { BrokerOrderVerifier } from '../adapters/BrokerOrderVerifier';
import { BrokerApiStalenessGuard } from '../guards/BrokerApiStalenessGuard';
import { SubmissionFreezeGuard } from '../guards/SubmissionFreezeGuard';
import { CancelledFillEscalator } from '../escalation/CancelledFillEscalator';
import { SentinelTransaction } from '../recovery/SentinelTransaction';
import { ProcessCrashDetector } from '../recovery/ProcessCrashDetector';
import { IAlertNotifier } from '../types';

// ---------- Test Helpers ----------

function mockNotifier(): IAlertNotifier {
  return { sendAlert: jest.fn().mockResolvedValue(undefined) };
}

function mockFillEvent(orderId = 'ORD001'): any {
  return {
    order_request_id: orderId,
    fill_qty: 10,
    fill_price: 250,
    fill_timestamp: new Date(),
  };
}

// ===========================
// 1. KillSwitch
// ===========================
describe('KillSwitch', () => {
  test('starts in ACTIVE state', async () => {
    const ks = new KillSwitch(mockNotifier());
    expect(await ks.getKillSwitchState()).toBe('ACTIVE');
  });

  test('transitions to EMERGENCY_STOP and sends alert', async () => {
    const notifier = mockNotifier();
    const ks = new KillSwitch(notifier);
    await ks.transition('EMERGENCY_STOP', 'test breach');
    expect(await ks.getKillSwitchState()).toBe('EMERGENCY_STOP');
    expect(notifier.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('EMERGENCY STOP'),
      expect.any(Object)
    );
  });

  test('no-op transition to same state skips alert', async () => {
    const notifier = mockNotifier();
    const ks = new KillSwitch(notifier);
    await ks.transition('ACTIVE');
    expect(notifier.sendAlert).not.toHaveBeenCalled();
  });

  test('can reset back to ACTIVE', async () => {
    const notifier = mockNotifier();
    const ks = new KillSwitch(notifier);
    await ks.transition('EMERGENCY_STOP', 'breach');
    await ks.transition('ACTIVE');
    expect(await ks.getKillSwitchState()).toBe('ACTIVE');
  });
});

// ===========================
// 2. StateRestorer
// ===========================
describe('StateRestorer', () => {
  test('throws on null session', async () => {
    const sr = new StateRestorer(mockNotifier());
    await expect(sr.initialize(null)).rejects.toThrow('Bootstrap failure');
  });

  test('throws on missing session_id', async () => {
    const sr = new StateRestorer(mockNotifier());
    await expect(sr.initialize({ session_id: '', rotating: false, rotation_in_progress: false })).rejects.toThrow();
  });

  test('initializes with valid session', async () => {
    const sr = new StateRestorer(mockNotifier());
    await sr.initialize({ session_id: 'sess-001', rotating: false, rotation_in_progress: false });
    expect(sr.getSession().session_id).toBe('sess-001');
  });

  test('getSession throws before initialization', () => {
    const sr = new StateRestorer(mockNotifier());
    expect(() => sr.getSession()).toThrow('StateRestorer not initialized');
  });
});

// ===========================
// 3. SessionRotationSerializer
// ===========================
describe('SessionRotationSerializer', () => {
  test('executes rotation and hydration in order', async () => {
    const log: string[] = [];
    const serializer = new SessionRotationSerializer(
      async () => { log.push('rotate'); },
      async () => { log.push('hydrate'); }
    );
    await serializer.requestRotation();
    expect(log).toEqual(['rotate', 'hydrate']);
  });

  test('rejects if rotation is requested too quickly (< 200ms)', async () => {
    const serializer = new SessionRotationSerializer(
      async () => {},
      async () => {}
    );
    await serializer.requestRotation();
    await expect(serializer.requestRotation()).rejects.toThrow('ROTATION_REJECTED');
  });

  test('throws ROTATION_QUEUE_FULL when queue is at cap of 5', async () => {
    // Use a slow rotate so items accumulate while item 1 is executing
    let rotateResolve: (() => void) | null = null;
    const slowRotate = () => new Promise<void>(r => { rotateResolve = r; });
    const serializer = new SessionRotationSerializer(slowRotate, async () => {});

    // Queue 5 rotations, waiting 201ms between each to pass the spacing gate
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 201));
      promises.push(serializer.requestRotation().catch(() => {}));
    }

    // Now pendingCount === 5 (1 executing + 4 queued).
    // The 6th request (201ms later) must throw ROTATION_QUEUE_FULL.
    await new Promise(r => setTimeout(r, 201));
    await expect(serializer.requestRotation()).rejects.toThrow('ROTATION_QUEUE_FULL');

    // Unblock the slow rotate so the test can clean up
    if (rotateResolve) (rotateResolve as () => void)();
  }, 15000);
});

// ===========================
// 4. BrokerPositionAdapter
// ===========================
describe('BrokerPositionAdapter', () => {
  const adapter = new BrokerPositionAdapter(mockNotifier());

  test('parses valid MIS position record', () => {
    const raw = {
      data: [{
        producttype: 'MIS',
        tradingsymbol: 'NIFTY',
        netqty: '5',
        avgnetprice: '20000.5',
        ltp: '20050',
        unrealised: '250',
        day_buy_qty: '5',
        day_sell_qty: '0',
      }]
    };
    const { positions, totalMISValue } = adapter.parsePositions(raw);
    expect(positions).toHaveLength(1);
    expect(positions[0].tradingsymbol).toBe('NIFTY');
    expect(totalMISValue).toBeCloseTo(100250, 0);
  });

  test('skips records with NaN fields', () => {
    const raw = {
      data: [{
        producttype: 'MIS',
        tradingsymbol: 'BADSTOCK',
        netqty: 'abc',     // bad value
        avgnetprice: '100',
        ltp: '100',
        unrealised: '0',
        day_buy_qty: '0',
        day_sell_qty: '0',
      }]
    };
    const { positions } = adapter.parsePositions(raw);
    expect(positions).toHaveLength(0);
  });

  test('returns empty on null data', () => {
    const { positions, totalMISValue } = adapter.parsePositions({ data: null });
    expect(positions).toHaveLength(0);
    expect(totalMISValue).toBe(0);
  });

  test('accumulates totalMISValue for multiple MIS positions', () => {
    const raw = {
      data: [
        { producttype: 'MIS', tradingsymbol: 'A', netqty: '10', avgnetprice: '100', ltp: '100', unrealised: '0', day_buy_qty: '10', day_sell_qty: '0' },
        { producttype: 'MIS', tradingsymbol: 'B', netqty: '5',  avgnetprice: '200', ltp: '200', unrealised: '0', day_buy_qty: '5',  day_sell_qty: '0' },
      ]
    };
    const { totalMISValue } = adapter.parsePositions(raw);
    expect(totalMISValue).toBeCloseTo(2000, 0); // 10*100 + 5*200
  });
});

// ===========================
// 5. BrokerOrderVerifier
// ===========================
describe('BrokerOrderVerifier', () => {
  const verifier = new BrokerOrderVerifier();

  test.each([
    ['complete',   'CONFIRMED_FILLED'],
    ['cancelled',  'CONFIRMED_CANCELLED'],
    ['rejected',   'CONFIRMED_CANCELLED'],
    ['open',       'CONFIRMED_PENDING'],
    ['unknown',    'NOT_FOUND'],
  ])('maps %s to %s', (raw, expected) => {
    expect(verifier.mapStatus(raw)).toBe(expected);
  });

  test('parses full order detail correctly', () => {
    const raw = {
      data: { orderid: 'ORD123', status: 'complete', filledshares: '5', averageprice: '250.0' }
    };
    const detail = verifier.parseOrderDetail(raw);
    expect(detail?.orderid).toBe('ORD123');
    expect(detail?.status).toBe('CONFIRMED_FILLED');
    expect(detail?.filledshares).toBe(5);
  });

  test('returns null on missing data', () => {
    expect(verifier.parseOrderDetail({})).toBeNull();
  });
});

// ===========================
// 6. BrokerApiStalenessGuard
// ===========================
describe('BrokerApiStalenessGuard', () => {
  const guard = new BrokerApiStalenessGuard(mockNotifier(), 30000);

  test('Tier 1: uses body timestamp and returns fresh', () => {
    const now = Date.now();
    const { ageMs, tier } = guard.assessAge({ lastUpdatedAt: new Date(now - 5000).toISOString(), localFetchTime: now }, now);
    expect(tier).toBe('Tier 1');
    expect(ageMs).toBeCloseTo(5000, -2);
  });

  test('Tier 2: falls back to HTTP Date header', () => {
    const now = Date.now();
    const { tier } = guard.assessAge({
      httpDateHeader: new Date(now - 10000).toUTCString(),
      localFetchTime: now
    }, now);
    expect(tier).toBe('Tier 2');
  });

  test('Tier 3: uses local fetch time + 60s buffer', () => {
    const now = Date.now();
    const { tier, ageMs } = guard.assessAge({ localFetchTime: now - 2000 }, now);
    expect(tier).toBe('Tier 3');
    expect(ageMs).toBeGreaterThanOrEqual(62000); // at least 60s conservative buffer
  });

  test('fresh data passes staleness check', async () => {
    const now = Date.now();
    await expect(
      guard.checkStaleness(async () => ({ lastUpdatedAt: new Date(now).toISOString(), localFetchTime: now }), () => now)
    ).resolves.not.toThrow();
  });
});

// ===========================
// 7. SubmissionFreezeGuard + CancelledFillEscalator
// ===========================
describe('SubmissionFreezeGuard', () => {
  beforeEach(() => {
    CancelledFillEscalator.clearEscrow();
  });

  test('passes when escrow is empty', () => {
    const guard = new SubmissionFreezeGuard();
    const result = guard.check();
    expect(result.passed).toBe(true);
  });

  test('blocks when escrow has pending order', () => {
    CancelledFillEscalator.addEscrowId('ORD999');
    const guard = new SubmissionFreezeGuard();
    const result = guard.check();
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('UNEXPECTED_FILL_PENDING_REVIEW');
  });
});

// ===========================
// 8. SentinelTransaction
// ===========================
describe('SentinelTransaction', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  test('succeeds on first attempt', async () => {
    const sentinel = new SentinelTransaction(mockNotifier(), jest.fn().mockResolvedValue(undefined), 3);
    await expect(sentinel.runStartupCheck()).resolves.not.toThrow();
  });

  test('retries and succeeds on second attempt', async () => {
    const dbFn = jest.fn()
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValueOnce(undefined);
    const sentinel = new SentinelTransaction(mockNotifier(), dbFn, 3);
    await expect(sentinel.runStartupCheck()).resolves.not.toThrow();
    expect(dbFn).toHaveBeenCalledTimes(2);
  }, 15000);

  test('throws PROCESS_EXIT_SIMULATED after max retries exceeded', async () => {
    const dbFn = jest.fn().mockRejectedValue(new Error('DB down'));
    const sentinel = new SentinelTransaction(mockNotifier(), dbFn, 2);
    await expect(sentinel.runStartupCheck()).rejects.toThrow('PROCESS_EXIT_SIMULATED');
    expect(dbFn).toHaveBeenCalledTimes(2);
  }, 15000);
});

// ===========================
// 9. ProcessCrashDetector
// ===========================
describe('ProcessCrashDetector', () => {
  test('does not call recovery if no crash detected', async () => {
    const serializer = new SessionRotationSerializer(async () => {}, async () => {});
    const recover = jest.fn().mockResolvedValue(undefined);
    const detector = new ProcessCrashDetector(serializer, mockNotifier(), recover);
    await detector.scanAndRecover();
    expect(recover).not.toHaveBeenCalled();
  });
});
