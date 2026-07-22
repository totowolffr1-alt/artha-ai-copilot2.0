/**
 * packages/phase5-strategy/src/__tests__/SignalEngine.test.ts
 * Artha AI — Phase 5 Signal Engine Tests
 */

import { SignalEngine } from '../signals/SignalEngine';
import { SmallCapSignalFilter, ISmallCapUniverseChecker } from '../signals/SmallCapSignalFilter';

describe('SignalEngine & IndicatorPipeline', () => {
  let engine: SignalEngine;
  // Start timestamp at 10:00 AM IST on a trading Wednesday (UTC+5:30 -> 04:30 UTC)
  let barTimeMs: number;

  beforeEach(() => {
    engine = new SignalEngine();
    barTimeMs = Date.UTC(2026, 6, 22, 4, 0); // 09:30 AM IST (04:00 UTC)
  });

  function nextBarDate(): Date {
    barTimeMs += 1 * 60 * 1000; // 1-minute candles for unit test
    return new Date(barTimeMs);
  }

  test('does not emit signal during warmup phase', () => {
    // Feed less than 50 bars (warmup for EMA50)
    for (let i = 1; i <= 40; i++) {
      const signal = engine.processBar('TCS', 100, 105, 95, 100 + i, 1000, nextBarDate());
      expect(signal).toBeNull();
    }
  });

  test('suppresses counter-trend LONG signals in TRENDING_DOWN regime', () => {
    // Warmup: Feed 50 bars at base price 100
    for (let i = 1; i <= 50; i++) {
      engine.processBar('TCS', 100, 102, 98, 100, 1000, nextBarDate());
    }

    // Pull price down aggressively to enter TRENDING_DOWN regime
    for (let i = 1; i <= 20; i++) {
      engine.processBar('TCS', 100 - i * 2, 102 - i * 2, 98 - i * 2, 100 - i * 2, 1000, nextBarDate());
    }

    // Try small bounce (counter-trend LONG)
    const sig = engine.processBar('TCS', 61, 63, 59, 62, 1000, nextBarDate());
    // Counter-trend LONG signal should be suppressed in strong TRENDING_DOWN regime
    expect(sig).toBeNull();
  });

  test('generates LONG signal in TRENDING_UP regime when RSI turns up with positive MACD', () => {
    // Warmup & Establish TRENDING_UP regime with moderate price growth
    let price = 100;
    for (let i = 1; i <= 50; i++) {
      engine.processBar('TCS', 100, 101, 99, 100, 1000, nextBarDate());
    }
    for (let i = 1; i <= 25; i++) {
      price += 0.4;
      engine.processBar('TCS', price - 0.2, price + 0.3, price - 0.3, price, 1000, nextBarDate());
    }

    // Dip slightly
    for (let i = 1; i <= 3; i++) {
      price -= 0.6;
      engine.processBar('TCS', price + 0.2, price + 0.2, price - 0.4, price, 1000, nextBarDate());
    }

    // Resume trend up and verify LONG signal is generated
    let sig: any = null;
    for (let step = 1; step <= 5; step++) {
      price += 0.8;
      const res = engine.processBar('TCS', price - 0.2, price + 0.5, price - 0.2, price, 1000, nextBarDate());
      if (res && res.direction === 'LONG') {
        sig = res;
        break;
      }
    }

    expect(sig).not.toBeNull();
    expect(sig?.direction).toBe('LONG');
    expect(sig?.regime).toBe('TRENDING_UP');
    expect(sig?.stop_loss).toBeLessThan(sig!.entry_price);
    expect(sig?.take_profit).toBeGreaterThan(sig!.entry_price);
  });
});

describe('SmallCapSignalFilter', () => {
  const mockUniverse: ISmallCapUniverseChecker = {
    isSmallCap: (symbol: string) => symbol === 'ABC' || symbol === 'XYZ',
    getCircuitLimitPct: (symbol: string) => symbol === 'ABC' ? 10 : 5,
  };

  const filter = new SmallCapSignalFilter(mockUniverse);

  test('blocks non-small-cap stocks', () => {
    const dummySignal: any = { symbol: 'RELIANCE' };
    const res = filter.filter(dummySignal);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('NOT_SMALL_CAP');
  });

  test('blocks small-cap stocks with 5% circuit limits', () => {
    const dummySignal: any = { symbol: 'XYZ' };
    const res = filter.filter(dummySignal);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('HIGH_RISK_CIRCUIT');
  });

  test('allows small-cap stocks with 10% circuit limits', () => {
    const dummySignal: any = { symbol: 'ABC' };
    const res = filter.filter(dummySignal);
    expect(res.allowed).toBe(true);
  });
});
