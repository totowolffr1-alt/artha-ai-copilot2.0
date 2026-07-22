/**
 * packages/phase5-strategy/src/__tests__/TradeJournal.test.ts
 * Artha AI — Trade Journal & Performance Analytics Unit Tests
 */

import { TradeJournalEngine } from '../journal/TradeJournalEngine';
import { PerformanceAnalytics, TradeRecord } from '../journal/PerformanceAnalytics';
import { SignalEvent } from '../signals/SignalEvent';

describe('TradeJournalEngine', () => {
  let engine: TradeJournalEngine;

  beforeEach(() => {
    engine = new TradeJournalEngine();
  });

  const dummySignal: SignalEvent = {
    signal_id: 'sig-001',
    symbol: 'RELIANCE',
    exchange: 'NSE',
    direction: 'LONG',
    strength: 'STRONG',
    confidence: 85,
    entry_price: 2500,
    stop_loss: 2470,
    take_profit: 2560,
    rsi: 42,
    macd_hist: 1.2,
    atr: 15,
    ema20: 2490,
    ema50: 2480,
    regime: 'TRENDING_UP',
    recommended_qty: 100,
    risk_amount: 3000,
    kelly_fraction: 0.0417,
    emitted_at: new Date('2026-07-22T10:00:00Z'),
    bar_ts: new Date('2026-07-22T10:00:00Z'),
  };

  test('opens trade with correct quantity and initial state', () => {
    const trade = engine.openTrade(dummySignal, 'INTRADAY');
    expect(trade.status).toBe('OPEN');
    expect(trade.symbol).toBe('RELIANCE');
    expect(trade.quantity).toBe(100);
    expect(trade.entryPrice).toBe(2500);
    expect(engine.getOpenTrades().length).toBe(1);
  });

  test('closes trade with accurate NSE costs, net P&L, and holding period', () => {
    const trade = engine.openTrade(dummySignal, 'INTRADAY');
    const exitTime = new Date('2026-07-22T10:45:00Z'); // 45 mins later

    const closed = engine.closeTrade(trade.tradeId, 2560, 'TARGET_HIT', exitTime);

    expect(closed).not.toBeNull();
    expect(closed?.status).toBe('CLOSED');
    expect(closed?.exitPrice).toBe(2560);
    expect(closed?.exitReason).toBe('TARGET_HIT');
    expect(closed?.holdingPeriodMins).toBe(45);

    // Gross P&L = (2560 - 2500) * 100 = ₹6,000
    expect(closed?.grossPnl).toBe(6000);
    // Net P&L must be less than gross P&L due to STT & charges
    expect(closed?.netPnl!).toBeLessThan(6000);
    expect(closed?.netPnl!).toBeGreaterThan(5800); // realistic net after fees
    expect(closed?.totalCosts!).toBeGreaterThan(50);
    expect(closed?.rMultiple!).toBeGreaterThan(1.5); // good R-multiple
  });

  test('automatically triggers TP hit on market tick', () => {
    engine.openTrade(dummySignal, 'INTRADAY');

    // Price moves to target 2560
    const closedList = engine.checkMarketTick('RELIANCE', 2560);

    expect(closedList.length).toBe(1);
    expect(closedList[0].exitReason).toBe('TARGET_HIT');
    expect(engine.getOpenTrades().length).toBe(0);
    expect(engine.getClosedJournal().length).toBe(1);
  });

  test('automatically triggers SL hit on market tick', () => {
    engine.openTrade(dummySignal, 'INTRADAY');

    // Price drops to stop 2470
    const closedList = engine.checkMarketTick('RELIANCE', 2465);

    expect(closedList.length).toBe(1);
    expect(closedList[0].exitReason).toBe('STOP_HIT');
    expect(closedList[0].netPnl).toBeLessThan(0);
  });
});

describe('PerformanceAnalytics — Quantitative Risk Metrics', () => {
  test('calculates institutional metrics correctly for winning and losing trades', () => {
    const mockTrades: TradeRecord[] = [
      {
        trade_id: 't1', symbol: 'TCS', direction: 'LONG', entry_price: 3000, exit_price: 3090,
        quantity: 50, entry_time: '2026-07-22T09:30:00Z', exit_time: '2026-07-22T10:30:00Z',
        status: 'CLOSED', gross_pnl: 4500, net_pnl: 4400, total_costs: 100, regime: 'TRENDING_UP'
      },
      {
        trade_id: 't2', symbol: 'INFY', direction: 'LONG', entry_price: 1500, exit_price: 1470,
        quantity: 100, entry_time: '2026-07-22T09:45:00Z', exit_time: '2026-07-22T10:15:00Z',
        status: 'CLOSED', gross_pnl: -3000, net_pnl: -3080, total_costs: 80, regime: 'TRENDING_DOWN'
      },
      {
        trade_id: 't3', symbol: 'HDFCBANK', direction: 'LONG', entry_price: 1600, exit_price: 1640,
        quantity: 100, entry_time: '2026-07-22T11:00:00Z', exit_time: '2026-07-22T12:00:00Z',
        status: 'CLOSED', gross_pnl: 4000, net_pnl: 3910, total_costs: 90, regime: 'TRENDING_UP'
      },
    ];

    const stats = PerformanceAnalytics.analyze(mockTrades, 1_000_000);

    expect(stats.totalTrades).toBe(3);
    expect(stats.closedTrades).toBe(3);
    expect(stats.winCount).toBe(2);
    expect(stats.lossCount).toBe(1);

    // Win rate = 2 / 3 = 66.7%
    expect(stats.winRatePct).toBeCloseTo(66.7, 0);

    // Gross profit = 4400 + 3910 = 8310, Gross loss = 3080
    // Profit factor = 8310 / 3080 = ~2.70
    expect(stats.profitFactor).toBeGreaterThan(2.0);

    // Net PnL = 4400 - 3080 + 3910 = ₹5,230
    expect(stats.netPnl).toBe(5230);
    expect(stats.totalCosts).toBe(270);

    // Regime breakdown check
    expect(stats.regimeBreakdown['TRENDING_UP']).toBeDefined();
    expect(stats.regimeBreakdown['TRENDING_UP'].winRatePct).toBe(100);
    expect(stats.regimeBreakdown['TRENDING_DOWN'].winRatePct).toBe(0);
  });
});
