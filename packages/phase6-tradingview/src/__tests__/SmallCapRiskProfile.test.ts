/**
 * packages/phase6-tradingview/src/__tests__/SmallCapRiskProfile.test.ts
 * Artha AI — Phase 6 Small-Cap Risk Profile Tests
 */

import { SmallCapRiskProfile } from '../risk/SmallCapRiskProfile';

describe('SmallCapRiskProfile', () => {
  test('returns standard multipliers for large cap', () => {
    // Large cap: bull=2.2, neutral=1.3, volatile=2.8
    expect(SmallCapRiskProfile.getAtrMultiplier('LARGECAP', false, false)).toBe(1.3);
    expect(SmallCapRiskProfile.getAtrMultiplier('LARGECAP', false, true)).toBe(2.2);
    expect(SmallCapRiskProfile.getAtrMultiplier('LARGECAP', true, false)).toBe(2.8);
  });

  test('returns wider stop multipliers for small cap tiers', () => {
    // SMALLCAP_100: bull=2.8, neutral=1.8, volatile=3.5
    expect(SmallCapRiskProfile.getAtrMultiplier('SMALLCAP_100', false, false)).toBe(1.8);
    expect(SmallCapRiskProfile.getAtrMultiplier('SMALLCAP_100', false, true)).toBe(2.8);
    expect(SmallCapRiskProfile.getAtrMultiplier('SMALLCAP_100', true, false)).toBe(3.5);

    // SMALLCAP_250: bull=3.2, neutral=2.0, volatile=4.0
    expect(SmallCapRiskProfile.getAtrMultiplier('SMALLCAP_250', false, false)).toBe(2.0);
    expect(SmallCapRiskProfile.getAtrMultiplier('SMALLCAP_250', false, true)).toBe(3.2);
    expect(SmallCapRiskProfile.getAtrMultiplier('SMALLCAP_250', true, false)).toBe(4.0);
  });

  test('determines safe order quantities based on daily volume', () => {
    // 1% of 100,000 = 1000 shares
    expect(SmallCapRiskProfile.isOrderSizeSafe(500, 100000)).toBe(true);
    expect(SmallCapRiskProfile.isOrderSizeSafe(1000, 100000)).toBe(true);
    expect(SmallCapRiskProfile.isOrderSizeSafe(1001, 100000)).toBe(false);
  });

  test('resolves minimum required volumes', () => {
    expect(SmallCapRiskProfile.getMinDailyVolume('SMALLCAP_100')).toBe(50000);
    expect(SmallCapRiskProfile.getMinDailyVolume('SMALLCAP_250')).toBe(25000);
  });
});
