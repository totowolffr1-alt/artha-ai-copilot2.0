/**
 * MultiTimeframe.test.ts — Phase 20 Unit Tests
 * Tests MultiTimeframeEngine candle aggregation and trend alignment evaluations.
 */

import { MultiTimeframeEngine, Candle } from '../intelligence/MultiTimeframeEngine';

function generateBar(timestamp: Date, close: number, volume = 1000): Candle {
  return {
    timestamp,
    open: close * 0.998,
    high: close * 1.002,
    low: close * 0.997,
    close,
    volume,
  };
}

describe('MultiTimeframeEngine', () => {
  let mtf: MultiTimeframeEngine;

  beforeEach(() => {
    mtf = new MultiTimeframeEngine();
  });

  test('processes 1-minute bars without throwing', () => {
    const baseTime = new Date('2026-07-22T09:30:00.000Z').getTime();
    for (let i = 0; i < 60; i++) {
      const barTime = new Date(baseTime + i * 60 * 1000);
      mtf.processBar('RELIANCE', generateBar(barTime, 2500 + i * 2));
    }

    const evalRes = mtf.evaluateAlignment('RELIANCE', 'LONG');
    expect(evalRes).toBeDefined();
    expect(evalRes.trend1m).toBe('BULLISH');
  });

  test('evaluates strong bullish alignment during uptrend series', () => {
    const baseTime = new Date('2026-07-22T09:30:00.000Z').getTime();
    for (let i = 0; i < 150; i++) {
      const barTime = new Date(baseTime + i * 60 * 1000);
      mtf.processBar('TCS', generateBar(barTime, 3200 + i * 3));
    }

    const evalRes = mtf.evaluateAlignment('TCS', 'LONG');
    expect(evalRes.isAlignedWithSignal).toBe(true);
    expect(evalRes.confidenceAdjustmentPct).toBe(10);
  });

  test('detects conflicting trend and applies -15% confidence penalty', () => {
    const baseTime = new Date('2026-07-22T09:30:00.000Z').getTime();
    // Generate downtrend over 300 bars (5 hours) to build 20+ 15m candles for EMA20/EMA50
    for (let i = 0; i < 300; i++) {
      const barTime = new Date(baseTime + i * 60 * 1000);
      mtf.processBar('INFY', generateBar(barTime, 1800 - i * 2));
    }

    // Evaluate LONG signal during strong downtrend
    const evalRes = mtf.evaluateAlignment('INFY', 'LONG');
    expect(evalRes.isAlignedWithSignal).toBe(false);
    expect(evalRes.confidenceAdjustmentPct).toBe(-15);
  });
});
