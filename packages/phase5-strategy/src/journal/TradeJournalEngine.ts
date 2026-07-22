/**
 * packages/phase5-strategy/src/journal/TradeJournalEngine.ts
 * Artha AI — Trade Journal Engine
 *
 * Manages active trade lifecycles (opening, monitoring, closing) and
 * calculates transaction costs, net P&L, holding period, and R-multiples.
 */

import { SignalEvent } from '../signals/SignalEvent';
import { TransactionCostModel, TradingSegment } from '../signals/TransactionCostModel';
import { PerformanceAnalytics, PerformanceSummary, TradeRecord } from './PerformanceAnalytics';

export type ExitReason = 'TARGET_HIT' | 'STOP_HIT' | 'TIME_EXIT' | 'MANUAL' | 'REGIME_FLIP';

export interface ActiveTrade {
  tradeId: string;
  signalId: string;
  symbol: string;
  segment: TradingSegment;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  entryTime: Date;
  regime: string;
  regimeConfidence: number;
  status: 'OPEN' | 'CLOSED';

  // Populated on exit
  exitPrice?: number;
  exitTime?: Date;
  exitReason?: ExitReason;
  grossPnl?: number;
  netPnl?: number;
  totalCosts?: number;
  rMultiple?: number;
  holdingPeriodMins?: number;
}

export class TradeJournalEngine {
  private readonly costModel = new TransactionCostModel();
  private readonly activeTrades = new Map<string, ActiveTrade>();
  private readonly closedJournal: ActiveTrade[] = [];

  /**
   * Opens a new trade from a SignalEvent.
   */
  openTrade(signal: SignalEvent, segment: TradingSegment = 'INTRADAY'): ActiveTrade {
    const tradeId = `trd-${Math.random().toString(36).substring(2, 11)}`;
    const quantity = signal.recommended_qty ?? 1;

    const trade: ActiveTrade = {
      tradeId,
      signalId: signal.signal_id,
      symbol: signal.symbol,
      segment,
      direction: signal.direction,
      entryPrice: signal.entry_price,
      stopLoss: signal.stop_loss,
      takeProfit: signal.take_profit,
      quantity,
      entryTime: new Date(signal.emitted_at),
      regime: signal.regime || 'UNKNOWN',
      regimeConfidence: signal.regime_confidence || 50,
      status: 'OPEN',
    };

    this.activeTrades.set(tradeId, trade);
    return trade;
  }

  /**
   * Closes an active trade by tradeId and calculates net P&L after all NSE fees.
   */
  closeTrade(
    tradeId: string,
    exitPrice: number,
    exitReason: ExitReason,
    exitTime: Date = new Date()
  ): ActiveTrade | null {
    const trade = this.activeTrades.get(tradeId);
    if (!trade || trade.status === 'CLOSED') return null;

    const costs = this.costModel.calculate({
      entryPrice: trade.entryPrice,
      exitPrice,
      quantity: trade.quantity,
      segment: trade.segment,
    });

    const entryMs = trade.entryTime.getTime();
    const exitMs  = exitTime.getTime();
    const holdingPeriodMins = Math.max(0, Math.round((exitMs - entryMs) / (60 * 1000)));

    // R-multiple: Net profit relative to initial rupee risk
    const initialRiskPerShare = Math.abs(trade.entryPrice - trade.stopLoss);
    const totalInitialRisk    = initialRiskPerShare * trade.quantity;
    const rMultiple           = totalInitialRisk > 0 ? costs.netPnl / totalInitialRisk : 0;

    trade.status            = 'CLOSED';
    trade.exitPrice         = exitPrice;
    trade.exitTime          = exitTime;
    trade.exitReason        = exitReason;
    trade.grossPnl          = Math.round(costs.grossPnl * 100) / 100;
    trade.netPnl            = Math.round(costs.netPnl * 100) / 100;
    trade.totalCosts        = Math.round(costs.totalCost * 100) / 100;
    trade.rMultiple         = Math.round(rMultiple * 100) / 100;
    trade.holdingPeriodMins = holdingPeriodMins;

    this.activeTrades.delete(tradeId);
    this.closedJournal.push(trade);
    return trade;
  }

  /**
   * Checks active trades against current LTP and automatically triggers exits on TP/SL hit.
   */
  checkMarketTick(symbol: string, currentLtp: number, tickTime: Date = new Date()): ActiveTrade[] {
    const closedThisTick: ActiveTrade[] = [];

    for (const [tradeId, trade] of this.activeTrades.entries()) {
      if (trade.symbol !== symbol) continue;

      if (trade.direction === 'LONG') {
        if (currentLtp >= trade.takeProfit) {
          const closed = this.closeTrade(tradeId, trade.takeProfit, 'TARGET_HIT', tickTime);
          if (closed) closedThisTick.push(closed);
        } else if (currentLtp <= trade.stopLoss) {
          const closed = this.closeTrade(tradeId, trade.stopLoss, 'STOP_HIT', tickTime);
          if (closed) closedThisTick.push(closed);
        }
      } else if (trade.direction === 'SHORT') {
        if (currentLtp <= trade.takeProfit) {
          const closed = this.closeTrade(tradeId, trade.takeProfit, 'TARGET_HIT', tickTime);
          if (closed) closedThisTick.push(closed);
        } else if (currentLtp >= trade.stopLoss) {
          const closed = this.closeTrade(tradeId, trade.stopLoss, 'STOP_HIT', tickTime);
          if (closed) closedThisTick.push(closed);
        }
      }
    }

    return closedThisTick;
  }

  getOpenTrades(): ActiveTrade[] {
    return Array.from(this.activeTrades.values());
  }

  getClosedJournal(): ActiveTrade[] {
    return [...this.closedJournal];
  }

  getAllJournal(): ActiveTrade[] {
    return [...Array.from(this.activeTrades.values()), ...this.closedJournal];
  }

  /**
   * Generates institutional performance summary for all trades in journal.
   */
  getPerformanceSummary(initialCapital = 1_000_000): PerformanceSummary {
    const records: TradeRecord[] = this.getAllJournal().map(t => ({
      trade_id: t.tradeId,
      symbol: t.symbol,
      direction: t.direction,
      entry_price: t.entryPrice,
      exit_price: t.exitPrice,
      quantity: t.quantity,
      entry_time: t.entryTime,
      exit_time: t.exitTime,
      status: t.status,
      exit_reason: t.exitReason,
      gross_pnl: t.grossPnl,
      net_pnl: t.netPnl,
      total_costs: t.totalCosts,
      regime: t.regime,
      r_multiple: t.rMultiple,
      holding_period_mins: t.holdingPeriodMins,
    }));

    return PerformanceAnalytics.analyze(records, initialCapital);
  }
}
