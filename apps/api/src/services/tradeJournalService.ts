/**
 * apps/api/src/services/tradeJournalService.ts
 * Artha AI — Trade Journal Service & Performance Analytics API layer
 */

import { tradeJournal, TradeJournalRecord } from '../db/sqlite';
import { TransactionCostModel } from '../../../../packages/phase5-strategy/src/signals/TransactionCostModel';
import { PerformanceAnalytics, PerformanceSummary, TradeRecord } from '../../../../packages/phase5-strategy/src/journal/PerformanceAnalytics';

const costModel = new TransactionCostModel();

export class TradeJournalService {
  /**
   * Records a new trade entry in SQLite.
   */
  static recordEntry(entry: {
    trade_id?: string;
    symbol: string;
    segment?: 'INTRADAY' | 'DELIVERY';
    direction: 'LONG' | 'SHORT';
    entry_price: number;
    quantity: number;
    stop_loss: number;
    take_profit: number;
    regime?: string;
    regime_confidence?: number;
  }): TradeJournalRecord {
    const trade_id = entry.trade_id || `trd-${Math.random().toString(36).substring(2, 11)}`;
    const segment = entry.segment || 'INTRADAY';

    return tradeJournal.insert({
      trade_id,
      symbol: entry.symbol,
      segment,
      direction: entry.direction,
      entry_price: entry.entry_price,
      quantity: entry.quantity,
      stop_loss: entry.stop_loss,
      take_profit: entry.take_profit,
      entry_time: new Date().toISOString(),
      status: 'OPEN',
      regime: entry.regime || 'TRENDING_UP',
      regime_confidence: entry.regime_confidence || 80,
    });
  }

  /**
   * Closes an open trade, calculates exact NSE transaction costs and net P&L.
   */
  static recordExit(
    tradeId: string,
    exitPrice: number,
    exitReason: 'TARGET_HIT' | 'STOP_HIT' | 'TIME_EXIT' | 'MANUAL' | 'REGIME_FLIP' = 'MANUAL'
  ): TradeJournalRecord | null {
    const openTrade = tradeJournal.getAll(500).find(t => t.trade_id === tradeId || t.id.toString() === tradeId);
    if (!openTrade || openTrade.status === 'CLOSED') return null;

    const costs = costModel.calculate({
      entryPrice: openTrade.entry_price,
      exitPrice,
      quantity: openTrade.quantity,
      segment: openTrade.segment,
    });

    const entryMs = new Date(openTrade.entry_time).getTime();
    const exitMs  = Date.now();
    const holding_period_mins = Math.max(1, Math.round((exitMs - entryMs) / (60 * 1000)));

    const initialRisk = Math.abs(openTrade.entry_price - openTrade.stop_loss) * openTrade.quantity;
    const r_multiple  = initialRisk > 0 ? Math.round((costs.netPnl / initialRisk) * 100) / 100 : 0;

    return tradeJournal.update(openTrade.trade_id, {
      status: 'CLOSED',
      exit_price: exitPrice,
      exit_time: new Date().toISOString(),
      exit_reason: exitReason,
      gross_pnl: Math.round(costs.grossPnl * 100) / 100,
      net_pnl: Math.round(costs.netPnl * 100) / 100,
      total_costs: Math.round(costs.totalCost * 100) / 100,
      r_multiple,
      holding_period_mins,
    });
  }

  /**
   * Gets list of trades filtered by status or symbol.
   */
  static getJournal(limit = 100, status?: 'OPEN' | 'CLOSED'): TradeJournalRecord[] {
    const all = tradeJournal.getAll(limit);
    if (status) return all.filter(t => t.status === status);
    return all;
  }

  /**
   * Computes institutional performance analytics summary over all recorded trades.
   */
  static getPerformanceMetrics(initialCapital = 1_000_000): PerformanceSummary {
    const all = tradeJournal.getAll(500);

    // If database is empty, seed demo trades so user sees realistic analytics on first load
    if (all.length === 0) {
      this.seedDemoTrades();
      return this.getPerformanceMetrics(initialCapital);
    }

    const records: TradeRecord[] = all.map(t => ({
      trade_id: t.trade_id,
      symbol: t.symbol,
      direction: t.direction,
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      quantity: t.quantity,
      entry_time: t.entry_time,
      exit_time: t.exit_time,
      status: t.status,
      exit_reason: t.exit_reason,
      gross_pnl: t.gross_pnl,
      net_pnl: t.net_pnl,
      total_costs: t.total_costs,
      regime: t.regime,
      r_multiple: t.r_multiple,
      holding_period_mins: t.holding_period_mins,
    }));

    return PerformanceAnalytics.analyze(records, initialCapital);
  }

  /**
   * Seeds demo realistic trade records if none exist.
   */
  private static seedDemoTrades(): void {
    const demoTrades = [
      { symbol: 'RELIANCE', direction: 'LONG', entry: 2480, exit: 2530, qty: 100, status: 'CLOSED', reason: 'TARGET_HIT', regime: 'TRENDING_UP', cost: 125, net: 4875 },
      { symbol: 'TCS', direction: 'LONG', entry: 3400, exit: 3370, qty: 50, status: 'CLOSED', reason: 'STOP_HIT', regime: 'TRENDING_DOWN', cost: 95, net: -1595 },
      { symbol: 'INFY', direction: 'LONG', entry: 1450, exit: 1490, qty: 150, status: 'CLOSED', reason: 'TARGET_HIT', regime: 'TRENDING_UP', cost: 110, net: 5890 },
      { symbol: 'HDFCBANK', direction: 'LONG', entry: 1620, exit: 1610, qty: 200, status: 'CLOSED', reason: 'TIME_EXIT', regime: 'SIDEWAYS', cost: 140, net: -2140 },
      { symbol: 'ICICIBANK', direction: 'LONG', entry: 980, exit: 1015, qty: 250, status: 'CLOSED', reason: 'TARGET_HIT', regime: 'TRENDING_UP', cost: 130, net: 8620 },
      { symbol: 'TATAMOTORS', direction: 'LONG', entry: 650, exit: 672, qty: 300, status: 'CLOSED', reason: 'TARGET_HIT', regime: 'TRENDING_UP', cost: 115, net: 6485 },
      { symbol: 'SBIN', direction: 'LONG', entry: 570, exit: 562, qty: 400, status: 'CLOSED', reason: 'STOP_HIT', regime: 'HIGH_VOLATILITY', cost: 120, net: -3320 },
      { symbol: 'AXISBANK', direction: 'LONG', entry: 1050, exit: 1085, qty: 150, status: 'CLOSED', reason: 'TARGET_HIT', regime: 'TRENDING_UP', cost: 105, net: 5145 },
    ];

    demoTrades.forEach((d, i) => {
      const entryTime = new Date(Date.now() - (10 - i) * 86400000).toISOString();
      const exitTime  = new Date(Date.now() - (10 - i) * 86400000 + 45 * 60000).toISOString();

      tradeJournal.insert({
        trade_id: `trd-demo-${i + 1}`,
        symbol: d.symbol,
        segment: 'INTRADAY',
        direction: d.direction as 'LONG' | 'SHORT',
        entry_price: d.entry,
        exit_price: d.exit,
        quantity: d.qty,
        stop_loss: d.direction === 'LONG' ? d.entry - 20 : d.entry + 20,
        take_profit: d.direction === 'LONG' ? d.entry + 40 : d.entry - 40,
        entry_time: entryTime,
        exit_time: exitTime,
        status: 'CLOSED',
        exit_reason: d.reason as any,
        gross_pnl: (d.exit - d.entry) * d.qty,
        net_pnl: d.net,
        total_costs: d.cost,
        regime: d.regime,
        regime_confidence: 85,
        r_multiple: d.net > 0 ? 2.1 : -1.0,
        holding_period_mins: 45,
      });
    });
  }
}
