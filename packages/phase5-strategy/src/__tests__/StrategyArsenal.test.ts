/**
 * packages/phase5-strategy/src/__tests__/StrategyArsenal.test.ts
 * Artha AI — Strategy Arsenal Unit Tests
 */

import { StrategyRouter } from '../strategies/StrategyRouter';
import { TrendFollowerStrategy } from '../strategies/TrendFollowerStrategy';
import { MeanReversionStrategy } from '../strategies/MeanReversionStrategy';
import { VolatilitySqueezeStrategy } from '../strategies/VolatilitySqueezeStrategy';
import { IndicatorSnapshot } from '../indicators/IndicatorPipeline';
import { RegimeClassification } from '../signals/RegimeEngine';

describe('Strategy Arsenal & StrategyRouter', () => {
  let router: StrategyRouter;
  const barTs = new Date('2026-07-22T10:30:00+05:30'); // Wednesday 10:30 AM IST (Safe market session)

  beforeEach(() => {
    router = new StrategyRouter();
  });

  const mockSnapshot: IndicatorSnapshot = {
    ema20: 105,
    ema50: 100,
    rsi14: 60,
    macd: { macd: 2.5, signal: 1.0, histogram: 1.5 },
    atr14: 3.0,
    bb20: { upper: 110, middle: 104, lower: 98, bandwidth: 11.5, percentB: 0.67 },
  };

  test('registers default strategy arsenal correctly', () => {
    const registered = router.getRegisteredStrategies();
    expect(registered).toContain('TREND_FOLLOWER');
    expect(registered).toContain('MEAN_REVERSION');
    expect(registered).toContain('VOLATILITY_SQUEEZE');
  });

  test('TrendFollowerStrategy generates LONG signal in TRENDING_UP regime', () => {
    const regime: RegimeClassification = {
      label: 'TRENDING_UP',
      confidence: 85,
      atrPct: 2.8,
      emaGapPct: 5.0,
      bbWidthPct: 11.5,
    };

    const sig = router.route('RELIANCE', 106, mockSnapshot, regime, 15000, barTs);
    expect(sig).not.toBeNull();
    expect(sig?.direction).toBe('LONG');
    expect(sig?.regime).toBe('TRENDING_UP');
    expect(sig?.confidence).toBeGreaterThanOrEqual(85);
  });

  test('MeanReversionStrategy generates LONG signal in SIDEWAYS regime near lower BB', () => {
    const regime: RegimeClassification = {
      label: 'SIDEWAYS',
      confidence: 80,
      atrPct: 1.2,
      emaGapPct: 0.1,
      bbWidthPct: 5.0,
    };

    const oversoldSnap: IndicatorSnapshot = {
      ...mockSnapshot,
      rsi14: 32,
      bb20: { upper: 110, middle: 104, lower: 98, bandwidth: 11.5, percentB: 0.0 },
    };

    const sig = router.route('TCS', 98, oversoldSnap, regime, 5000, barTs);
    expect(sig).not.toBeNull();
    expect(sig?.direction).toBe('LONG');
    expect(sig?.regime).toBe('SIDEWAYS');
  });

  test('VolatilitySqueezeStrategy generates breakout signal in LOW_VOLATILITY regime', () => {
    const regime: RegimeClassification = {
      label: 'LOW_VOLATILITY',
      confidence: 85,
      atrPct: 0.3,
      emaGapPct: 0.01,
      bbWidthPct: 1.8,
    };

    const tightSnap: IndicatorSnapshot = {
      ...mockSnapshot,
      bb20: { upper: 101, middle: 100, lower: 99, bandwidth: 2.0, percentB: 0.5 },
    };

    const sig = router.route('INFY', 100.5, tightSnap, regime, 2000, barTs);
    expect(sig).not.toBeNull();
    expect(sig?.direction).toBe('LONG');
    expect(sig?.regime).toBe('LOW_VOLATILITY');
  });

  test('suppresses signals outside market hours', () => {
    const closedTs = new Date('2026-07-22T17:00:00+05:30'); // 5 PM IST (Closed)
    const regime: RegimeClassification = {
      label: 'TRENDING_UP',
      confidence: 85,
      atrPct: 2.8,
      emaGapPct: 5.0,
      bbWidthPct: 11.5,
    };

    const sig = router.route('RELIANCE', 106, mockSnapshot, regime, 15000, closedTs);
    expect(sig).toBeNull();
  });
});
