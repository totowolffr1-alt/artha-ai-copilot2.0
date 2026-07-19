/**
 * packages/phase10-copilot-intelligence/src/__tests__/SmallCapNews.test.ts
 * Artha AI — Phase 10 Small-Cap & News Guard Tests
 */

import { SmallCapUniverseLoader, UniverseEntry } from '../universe/SmallCapUniverseLoader';
import { NewsEventGuard, CorporateEvent } from '../guards/NewsEventGuard';

describe('SmallCapUniverseLoader', () => {
  const dummyUniverse: UniverseEntry[] = [
    {
      symbol: 'ABC',
      company_name: 'ABC Smallcap',
      sector: 'IT',
      index_name: 'SMALLCAP_100',
      circuit_category: 'CAT_B', // 10%
      avg_daily_volume: 60000,
      market_cap_cr: 1200,
    },
    {
      symbol: 'XYZ',
      company_name: 'XYZ Microcap',
      sector: 'Finance',
      index_name: 'SMALLCAP_250',
      circuit_category: 'CAT_T', // 5%
      avg_daily_volume: 15000, // thin liquidity
      market_cap_cr: 400,
    }
  ];

  const dbQueryMock = jest.fn().mockResolvedValue(dummyUniverse);
  const loader = new SmallCapUniverseLoader(dbQueryMock);

  beforeAll(async () => {
    await loader.load();
  });

  test('correctly tags small-cap symbols', () => {
    expect(loader.isSmallCap('ABC')).toBe(true);
    expect(loader.isSmallCap('XYZ')).toBe(true);
    expect(loader.isSmallCap('RELIANCE')).toBe(false); // not in universe
  });

  test('resolves correct circuit limits', () => {
    expect(loader.getCircuitLimitPct('ABC')).toBe(10);
    expect(loader.getCircuitLimitPct('XYZ')).toBe(5);
    expect(loader.getCircuitLimitPct('UNKNOWN')).toBe(20); // default
  });

  test('gets correct ATR multipliers', () => {
    const abcMults = loader.getAtrMultipliers('ABC');
    expect(abcMults.bull).toBe(2.8);
    expect(abcMults.neutral).toBe(1.8);
    expect(abcMults.volatile).toBe(3.5);
  });

  test('checks liquidity/order quantity ratio safety', () => {
    // ABC has 60,000 avg volume. 1% is 600.
    expect(loader.isLiquidEnough('ABC', 500)).toBe(true);
    expect(loader.isLiquidEnough('ABC', 1000)).toBe(false); // exceeds 1% daily volume

    // XYZ has 15,000 avg volume which is less than index threshold 25,000
    expect(loader.isLiquidEnough('XYZ', 10)).toBe(false);
  });
});

describe('NewsEventGuard', () => {
  const dummyEvents: CorporateEvent[] = [
    {
      symbol: 'ABC',
      event_type: 'EARNINGS',
      event_date: new Date('2025-06-15T00:00:00.000Z'),
      description: 'Q4 Earnings',
      blackout_hours: 48,
    }
  ];

  const fetchMock = jest.fn().mockResolvedValue(dummyEvents);
  const guard = new NewsEventGuard(fetchMock);

  test('passes when outside corporate event blackout period', async () => {
    const testDate = new Date('2025-06-10T12:00:00.000Z');
    const result = await guard.checkBlackout('ABC', testDate);
    expect(result.passed).toBe(true);
  });

  test('blocks when within 48 hour blackout leading to event date', async () => {
    const testDate = new Date('2025-06-13T12:00:00.000Z'); // 36 hours before event
    const result = await guard.checkBlackout('ABC', testDate);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('PRE_EVENT_BLACKOUT');
  });

  test('blocks on event date itself', async () => {
    const testDate = new Date('2025-06-15T10:00:00.000Z'); // event day
    const result = await guard.checkBlackout('ABC', testDate);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('EVENT_DAY_BLACKOUT');
  });
});
