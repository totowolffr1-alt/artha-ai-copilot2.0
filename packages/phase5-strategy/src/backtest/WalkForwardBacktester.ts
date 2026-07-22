/**
 * WalkForwardBacktester.ts — Phase 20 Walk-Forward Backtesting Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional walk-forward historical backtesting simulation engine.
 *
 * Simulates real-time closed-loop execution on historical candlestick series with:
 *  - Dynamic Strategy Router (TrendFollower, MeanReversion, VolatilitySqueeze)
 *  - Market Regime Engine
 *  - Quarter-Kelly Position Sizer
 *  - Realistic NSE Transaction Cost Model (STT, GST, SEBI fee, flat ₹20 brokerage)
 *  - Institutional Performance Analytics (Win Rate, Sharpe, Sortino, Max Drawdown)
 */

import { StrategyRouter } from '../strategies/StrategyRouter';
import { IndicatorPipeline } from '../indicators/IndicatorPipeline';
import { RegimeEngine } from '../signals/RegimeEngine';
import { TransactionCostModel } from '../signals/TransactionCostModel';
import { PerformanceAnalytics, TradeRecord, PerformanceSummary } from '../journal/PerformanceAnalytics';
import { Candle } from '../intelligence/MultiTimeframeEngine';

export interface BacktestConfig {
  initialCapital: number;            // e.g. 100,000
  isDelivery?: boolean;               // false = intraday, true = delivery
  symbol: string;
  startDate?: Date;
  endDate?: Date;
}

export interface BacktestTradeLog {
  trade_id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price: number;
  quantity: number;
  entry_time: Date;
  exit_time: Date;
  status: 'CLOSED';
  strategy: string;
  regime: string;
  gross_pnl: number;
  total_costs: number;
  net_pnl: number;
  holdingPeriodMinutes: number;
}

export interface EquityCurvePoint {
  timestamp: Date;
  equity: number;
  drawdownPct: number;
}

export interface BacktestResult {
  symbol: string;
  initialCapital: number;
  finalEquity: number;
  totalNetPnL: number;
  totalGainPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  metrics: PerformanceSummary;
  trades: BacktestTradeLog[];
  equityCurve: EquityCurvePoint[];
}

export class WalkForwardBacktester {
  private router = new StrategyRouter();
  private pipeline = new IndicatorPipeline();
  private regimeEngine = new RegimeEngine();
  private costModel = new TransactionCostModel();

  /**
   * Runs a complete backtest simulation over a historical array of candles.
   */
  run(candles: Candle[], config: BacktestConfig): BacktestResult {
    const initialCapital = Math.max(1_000, config.initialCapital);
    const symbol = config.symbol;

    this.router.setPortfolioEquity(initialCapital);

    let currentEquity = initialCapital;
    let peakEquity = initialCapital;

    const tradesLog: BacktestTradeLog[] = [];
    const equityCurve: EquityCurvePoint[] = [
      { timestamp: candles[0]?.timestamp ?? new Date(), equity: initialCapital, drawdownPct: 0 }
    ];

    // Open trade state
    let activeTrade: {
      tradeId: string;
      symbol: string;
      direction: 'LONG' | 'SHORT';
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      quantity: number;
      entryTs: Date;
      strategy: string;
      regime: string;
    } | null = null;

    for (let i = 0; i < candles.length; i++) {
      const bar = candles[i];
      const snapshot = this.pipeline.feed(bar.open, bar.high, bar.low, bar.close, bar.volume);
      const regime = this.regimeEngine.classify(snapshot, bar.close);

      // Skip warmup phase
      if (regime.label === 'WARMUP') continue;

      // 1. Manage active trade auto-exit
      if (activeTrade) {
        let isExit = false;
        let exitPrice = bar.close;

        if (activeTrade.direction === 'LONG') {
          if (bar.high >= activeTrade.takeProfit) {
            isExit = true;
            exitPrice = activeTrade.takeProfit;
          } else if (bar.low <= activeTrade.stopLoss) {
            isExit = true;
            exitPrice = activeTrade.stopLoss;
          }
        } else if (activeTrade.direction === 'SHORT') {
          if (bar.low <= activeTrade.takeProfit) {
            isExit = true;
            exitPrice = activeTrade.takeProfit;
          } else if (bar.high >= activeTrade.stopLoss) {
            isExit = true;
            exitPrice = activeTrade.stopLoss;
          }
        }

        if (isExit) {
          const grossPnL = activeTrade.direction === 'LONG'
            ? (exitPrice - activeTrade.entryPrice) * activeTrade.quantity
            : (activeTrade.entryPrice - exitPrice) * activeTrade.quantity;

          const costs = this.costModel.calculate({
            entryPrice: activeTrade.entryPrice,
            exitPrice,
            quantity: activeTrade.quantity,
            segment: config.isDelivery ? 'DELIVERY' : 'INTRADAY',
          });

          const netPnL = grossPnL - costs.totalCost;
          currentEquity += netPnL;
          peakEquity = Math.max(peakEquity, currentEquity);
          this.router.setPortfolioEquity(currentEquity);

          const drawdownPct = ((peakEquity - currentEquity) / peakEquity) * 100;
          const durationMs = bar.timestamp.getTime() - activeTrade.entryTs.getTime();
          const holdingMins = Math.max(1, Math.round(durationMs / 60000));

          const tradeLog: BacktestTradeLog = {
            trade_id: activeTrade.tradeId,
            symbol: activeTrade.symbol,
            direction: activeTrade.direction,
            entry_price: activeTrade.entryPrice,
            exit_price: exitPrice,
            quantity: activeTrade.quantity,
            entry_time: activeTrade.entryTs,
            exit_time: bar.timestamp,
            status: 'CLOSED',
            strategy: activeTrade.strategy,
            regime: activeTrade.regime,
            gross_pnl: grossPnL,
            total_costs: costs.totalCost,
            net_pnl: netPnL,
            holdingPeriodMinutes: holdingMins,
          };

          tradesLog.push(tradeLog);
          equityCurve.push({ timestamp: bar.timestamp, equity: currentEquity, drawdownPct });
          activeTrade = null;
        }
      }

      // 2. Evaluate strategy router for new signals if no active trade
      if (!activeTrade) {
        const signal = this.router.route(symbol, bar.close, snapshot, regime, bar.volume, bar.timestamp);
        if (signal && signal.recommended_qty && signal.recommended_qty > 0) {
          activeTrade = {
            tradeId: signal.signal_id,
            symbol: signal.symbol,
            direction: signal.direction,
            entryPrice: signal.entry_price,
            stopLoss: signal.stop_loss,
            takeProfit: signal.take_profit,
            quantity: signal.recommended_qty,
            entryTs: bar.timestamp,
            strategy: signal.regime ?? 'TREND_FOLLOWER',
            regime: regime.label,
          };
        }
      }
    }

    // Convert tradesLog to TradeRecord format for PerformanceAnalytics
    const records: TradeRecord[] = tradesLog.map(t => ({
      trade_id: t.trade_id,
      symbol: t.symbol,
      direction: t.direction,
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      quantity: t.quantity,
      entry_time: t.entry_time,
      exit_time: t.exit_time,
      status: 'CLOSED',
      gross_pnl: t.gross_pnl,
      net_pnl: t.net_pnl,
      total_costs: t.total_costs,
      regime: t.regime,
      holding_period_mins: t.holdingPeriodMinutes,
    }));

    const metrics = PerformanceAnalytics.analyze(records, initialCapital);
    const winningTrades = tradesLog.filter(t => t.net_pnl > 0).length;
    const losingTrades = tradesLog.filter(t => t.net_pnl <= 0).length;
    const totalNetPnL = currentEquity - initialCapital;
    const totalGainPct = (totalNetPnL / initialCapital) * 100;

    return {
      symbol,
      initialCapital,
      finalEquity: Math.round(currentEquity * 100) / 100,
      totalNetPnL: Math.round(totalNetPnL * 100) / 100,
      totalGainPct: Math.round(totalGainPct * 100) / 100,
      totalTrades: tradesLog.length,
      winningTrades,
      losingTrades,
      metrics,
      trades: tradesLog,
      equityCurve,
    };
  }
}
