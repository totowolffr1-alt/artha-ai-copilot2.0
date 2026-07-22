/**
 * WalkForwardBacktester.test.ts — Phase 20 Unit Tests
 * Tests WalkForwardBacktester simulation execution on historical candle series.
 */

import { WalkForwardBacktester } from '../backtest/WalkForwardBacktester';
import { Candle } from '../intelligence/MultiTimeframeEngine';

function generateHistoricalSeries(count: number, startPrice: number, trendMultiplier = 1): Candle[] {
  const candles: Candle[] = [];
  const startTime = new Date('2026-06-01T09:15:00.000Z').getTime();
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const time = new Date(startTime + i * 60 * 1000);
    const noise = (Math.sin(i / 5) + Math.cos(i / 10)) * 2;
    price = Math.max(10, price + trendMultiplier * 0.5 + noise);

    candles.push({
      timestamp: time,
      open: price - 1,
      high: price + 2,
      low: price - 2,
      close: price,
      volume: 5000 + (i % 100) * 10,
    });
  }

  return candles;
}

describe('WalkForwardBacktester Engine', () => {
  let backtester: WalkForwardBacktester;

  beforeEach(() => {
    backtester = new WalkForwardBacktester();
  });

  test('runs backtest simulation on 150 historical candles without error', () => {
    const candles = generateHistoricalSeries(150, 1000, 1.2); // Strong uptrend
    const result = backtester.run(candles, {
      initialCapital: 100_000,
      symbol: 'RELIANCE',
      isDelivery: false,
    });

    expect(result).toBeDefined();
    expect(result.symbol).toBe('RELIANCE');
    expect(result.initialCapital).toBe(100_000);
    expect(result.finalEquity).toBeGreaterThan(0);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.metrics).toBeDefined();
  });

  test('calculates accurate net P&L after realistic NSE costs', () => {
    const candles = generateHistoricalSeries(200, 500, 1.5);
    const result = backtester.run(candles, {
      initialCapital: 50_000,
      symbol: 'CUPID',
      isDelivery: false,
    });

    if (result.trades.length > 0) {
      const trade = result.trades[0];
      expect(trade.total_costs).toBeGreaterThan(0);
      expect(trade.net_pnl).toBe(trade.gross_pnl - trade.total_costs);
    }
  });

  test('returns 0 trades if candle series is shorter than indicator warmup', () => {
    const shortCandles = generateHistoricalSeries(20, 100); // 20 candles < 50 warmup
    const result = backtester.run(shortCandles, {
      initialCapital: 10_000,
      symbol: 'TCS',
    });

    expect(result.totalTrades).toBe(0);
    expect(result.finalEquity).toBe(10_000);
  });
});
