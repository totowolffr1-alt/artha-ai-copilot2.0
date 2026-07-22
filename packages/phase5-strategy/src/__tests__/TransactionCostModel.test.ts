/**
 * packages/phase5-strategy/src/__tests__/TransactionCostModel.test.ts
 * Artha AI — NSE Transaction Cost Model Unit Tests
 */

import { TransactionCostModel } from '../signals/TransactionCostModel';

describe('TransactionCostModel — NSE Realistic Costs', () => {
  const model = new TransactionCostModel();

  test('intraday trade: STT applies only on sell side', () => {
    const result = model.calculate({
      entryPrice: 1000,
      exitPrice: 1010,
      quantity: 100,
      segment: 'INTRADAY',
    });

    // Entry turnover = 1000 * 100 = ₹1,00,000
    // Exit turnover  = 1010 * 100 = ₹1,01,000
    // Total turnover = ₹2,01,000
    // STT = exit only = 1,01,000 * 0.025% = ₹25.25
    expect(result.entryTurnover).toBe(100_000);
    expect(result.exitTurnover).toBe(101_000);
    expect(result.totalTurnover).toBe(201_000);
    expect(result.stt).toBeCloseTo(25.25, 1);

    // Gross P&L = (1010 - 1000) * 100 = ₹1000
    expect(result.grossPnl).toBe(1000);

    // Net P&L must be less than gross P&L
    expect(result.netPnl).toBeLessThan(result.grossPnl);

    // Total cost should be > 0
    expect(result.totalCost).toBeGreaterThan(0);
  });

  test('delivery trade: STT applies on both sides', () => {
    const result = model.calculate({
      entryPrice: 500,
      exitPrice: 550,
      quantity: 200,
      segment: 'DELIVERY',
    });

    // Entry = ₹1,00,000 | Exit = ₹1,10,000 | Total = ₹2,10,000
    // STT = 2,10,000 * 0.1% = ₹210 (both sides)
    expect(result.stt).toBeCloseTo(210, 0);
    expect(result.grossPnl).toBe(10_000);
  });

  test('flat brokerage: ₹20 per order × 2 orders = ₹40', () => {
    const result = model.calculate({
      entryPrice: 200,
      exitPrice: 210,
      quantity: 50,
      segment: 'INTRADAY',
    });

    expect(result.brokerage).toBe(40); // 2 × ₹20
  });

  test('breakeven move is positive and non-trivial', () => {
    const result = model.calculate({
      entryPrice: 1000,
      exitPrice: 1000, // flat exit — only costs
      quantity: 100,
      segment: 'INTRADAY',
    });

    // Break-even move should be positive (need price to move to cover costs)
    expect(result.breakEvenMoveAbs).toBeGreaterThan(0);
    expect(result.breakEvenMovePct).toBeGreaterThan(0);
    expect(result.netPnl).toBeLessThan(0); // lost money at flat exit
  });

  test('cost percentage is reasonable (< 0.15% of turnover for intraday)', () => {
    const result = model.calculate({
      entryPrice: 2000,
      exitPrice: 2020,
      quantity: 100,
      segment: 'INTRADAY',
    });

    // Total costs as % of turnover should be realistic (< 0.15%)
    expect(result.costPct).toBeLessThan(0.15);
    expect(result.costPct).toBeGreaterThan(0);
  });

  test('stamp duty applies only to buy side', () => {
    const result = model.calculate({
      entryPrice: 1000,
      exitPrice: 1000,
      quantity: 100,
      segment: 'INTRADAY',
    });

    // Stamp duty = entryTurnover * 0.015% = 100,000 * 0.00015 = ₹15
    expect(result.stampDuty).toBeCloseTo(15, 1);
  });
});
