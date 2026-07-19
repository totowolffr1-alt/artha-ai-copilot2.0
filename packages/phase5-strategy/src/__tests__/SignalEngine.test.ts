/**
 * packages/phase5-strategy/src/__tests__/SignalEngine.test.ts
 * Artha AI — Phase 5 Signal Engine Tests
 */

import { SignalEngine } from '../signals/SignalEngine';
import { SmallCapSignalFilter, ISmallCapUniverseChecker } from '../signals/SmallCapSignalFilter';

describe('SignalEngine & IndicatorPipeline', () => {
  let engine: SignalEngine;

  beforeEach(() => {
    engine = new SignalEngine();
  });

  test('does not emit signal during warmup phase', () => {
    // Feed less than 50 bars (warmup for EMA50)
    for (let i = 1; i <= 40; i++) {
      const signal = engine.processBar('TCS', 100, 105, 95, 100 + i, 1000);
      expect(signal).toBeNull();
    }
  });

  test('generates LONG signal when RSI crosses up 35 + MACD hist is positive', () => {
    // Warmup: Feed 50 bars at base price 100
    for (let i = 1; i <= 50; i++) {
      engine.processBar('TCS', 100, 102, 98, 100, 1000);
    }

    // Now pull the price down to oversell the RSI (e.g. drop from 100 to 50)
    for (let i = 1; i <= 10; i++) {
      engine.processBar('TCS', 50, 52, 48, 50, 1000);
    }

    // Now push price up slowly to trigger a cross-up of RSI 35 and positive MACD hist
    // Let's verify that eventually a LONG signal is triggered
    let signalFound = false;
    for (let price = 52; price <= 80; price += 2) {
      const sig = engine.processBar('TCS', price, price + 2, price - 2, price, 1000);
      if (sig && sig.direction === 'LONG') {
        signalFound = true;
        expect(sig.symbol).toBe('TCS');
        expect(sig.rsi).toBeGreaterThanOrEqual(35);
        expect(sig.macd_hist).toBeGreaterThan(0);
        expect(sig.stop_loss).toBeLessThan(sig.entry_price);
        expect(sig.take_profit).toBeGreaterThan(sig.entry_price);
        break;
      }
    }
    expect(signalFound).toBe(true);
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
