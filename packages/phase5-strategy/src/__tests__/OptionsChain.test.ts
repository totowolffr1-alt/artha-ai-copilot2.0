/**
 * OptionsChain.test.ts — Phase 20 Unit Tests
 * Tests OptionsChainAnalytics PCR calculation, IV Rank regimes, Max Pain, and signal vetoes.
 */

import { OptionsChainAnalytics, OptionsChainSnapshot, OptionStrike } from '../intelligence/OptionsChainAnalytics';

describe('OptionsChainAnalytics', () => {
  let analytics: OptionsChainAnalytics;

  beforeEach(() => {
    analytics = new OptionsChainAnalytics();
  });

  test('calculates Max Pain strike correctly', () => {
    const strikes: OptionStrike[] = [
      { strikePrice: 24000, callOI: 50000, callIV: 15, putOI: 10000, putIV: 14 },
      { strikePrice: 24200, callOI: 80000, callIV: 16, putOI: 90000, putIV: 15 },
      { strikePrice: 24400, callOI: 120000, callIV: 18, putOI: 40000, putIV: 16 },
    ];

    const maxPain = OptionsChainAnalytics.calculateMaxPain(strikes);
    expect(maxPain).toBeGreaterThan(0);
    expect(maxPain).toBe(24200);
  });

  test('evaluates bullish PCR (> 1.2) bias and boosts confidence', () => {
    const snapshot: OptionsChainSnapshot = {
      underlyingSymbol: 'NIFTY',
      underlyingPrice: 24300,
      expiryDate: '2026-07-30',
      totalCallOI: 100_000,
      totalPutOI: 140_000, // PCR = 1.4
      pcr: 1.4,
      maxPainStrike: 24300,
      averageIV: 15,
      ivRank: 45,
      strikes: [],
    };
    analytics.updateSnapshot(snapshot);

    const evalRes = analytics.evaluateBias('NIFTY', 'LONG', 24300);
    expect(evalRes.pcrBias).toBe('BULLISH');
    expect(evalRes.isAlignedWithSignal).toBe(true);
    expect(evalRes.confidenceAdjustmentPct).toBe(10);
    expect(evalRes.veto).toBe(false);
  });

  test('vetoes LONG signal when PCR is extremely bearish (< 0.55)', () => {
    const snapshot: OptionsChainSnapshot = {
      underlyingSymbol: 'NIFTY',
      underlyingPrice: 24300,
      expiryDate: '2026-07-30',
      totalCallOI: 200_000,
      totalPutOI: 80_000, // PCR = 0.40
      pcr: 0.40,
      maxPainStrike: 24100,
      averageIV: 18,
      ivRank: 80,
      strikes: [],
    };
    analytics.updateSnapshot(snapshot);

    const evalRes = analytics.evaluateBias('NIFTY', 'LONG', 24300);
    expect(evalRes.pcrBias).toBe('BEARISH');
    expect(evalRes.veto).toBe(true);
    expect(evalRes.vetoReason).toContain('PCR is extremely bearish');
  });

  test('returns neutral evaluation when options snapshot is absent', () => {
    const evalRes = analytics.evaluateBias('ZOMATO', 'LONG', 230);
    expect(evalRes.pcrBias).toBe('NEUTRAL');
    expect(evalRes.veto).toBe(false);
    expect(evalRes.confidenceAdjustmentPct).toBe(0);
  });
});
