/**
 * packages/phase5-strategy/src/__tests__/PositionSizer.test.ts
 * Artha AI — Phase 14 Position Sizer Unit Tests
 */

import { PositionSizer } from '../signals/PositionSizer';

describe('PositionSizer', () => {
  let sizer: PositionSizer;

  beforeEach(() => {
    sizer = new PositionSizer();
  });

  test('calculates fixed-fractional risk position size correctly', () => {
    // Portfolio: ₹1,000,000 | Risk 1% = ₹10,000 | Entry ₹500 | Stop ₹480 | StopDist ₹20
    // Risk Qty   = 10,000 / 20 = 500 shares
    // Quarter-Kelly fraction = ((0.5*1.5 - 0.5)/1.5)*0.25 = 0.0417 -> Budget ₹41,667 -> 83 shares ← binding
    // Exposure cap  = 10% of 1M = ₹100,000 / 500 = 200 shares
    // Kelly cap (83) is the smallest → KELLY_CAP binds
    const res = sizer.calculate({
      portfolioEquity: 1000000,
      riskPerTradePct: 0.01,
      entryPrice: 500,
      stopLossPrice: 480,
      atr14: 10,
    });

    expect(res.recommendedQty).toBe(83);
    expect(res.sizingMethod).toBe('KELLY_CAP');
    expect(res.capitalRequired).toBe(83 * 500);
    expect(res.riskAmount).toBeCloseTo(83 * 20, 0);
  });

  test('applies Quarter-Kelly cap when Kelly constraint is binding', () => {
    // Portfolio Equity: ₹1,000,000, Entry: ₹2000, StopLoss: ₹1950 (Stop distance: ₹50)
    // 1% Risk Qty = 10,000 / 50 = 200 shares (Capital needed: ₹400,000)
    // Max Exposure 10% Budget = ₹100,000 -> 100,000 / 2000 = 50 shares
    // Quarter Kelly fraction = ~0.0416 (4.16% of 1M = ₹41,666) -> 41,666 / 2000 = 20 shares
    // Kelly cap (20 shares) binds!
    const res = sizer.calculate({
      portfolioEquity: 1000000,
      riskPerTradePct: 0.01,
      entryPrice: 2000,
      stopLossPrice: 1950,
      atr14: 25,
      winRateEstimate: 0.50,
      winLossRatio: 1.5,
    });

    expect(res.recommendedQty).toBe(20);
    expect(res.sizingMethod).toBe('KELLY_CAP');
  });

  test('scales position size down by 50% during 5% drawdown', () => {
    const resNormal = sizer.calculate({
      portfolioEquity: 1000000,
      entryPrice: 100,
      stopLossPrice: 95,
      atr14: 3,
      currentDrawdownPct: 0.0,
    });

    const resDD = sizer.calculate({
      portfolioEquity: 1000000,
      entryPrice: 100,
      stopLossPrice: 95,
      atr14: 3,
      currentDrawdownPct: 0.06, // 6% drawdown
    });

    expect(resDD.drawdownScale).toBe(0.5);
    expect(resDD.recommendedQty).toBe(Math.floor(resNormal.recommendedQty * 0.5));
  });

  test('halts position sizing (0 quantity) during 10%+ drawdown circuit breaker', () => {
    const res = sizer.calculate({
      portfolioEquity: 1000000,
      entryPrice: 100,
      stopLossPrice: 95,
      atr14: 3,
      currentDrawdownPct: 0.12, // 12% drawdown
    });

    expect(res.recommendedQty).toBe(0);
    expect(res.drawdownScale).toBe(0.0);
    expect(res.sizingMethod).toBe('DRAWDOWN_HALT');
  });
});
