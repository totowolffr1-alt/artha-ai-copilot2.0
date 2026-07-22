/**
 * packages/phase5-strategy/src/journal/PerformanceAnalytics.ts
 * Artha AI — Institutional Performance Analytics Engine
 *
 * Computes Wall-Street grade risk & performance metrics:
 *  - Win Rate, Profit Factor, Expectancy
 *  - Net P&L, Total Transaction Costs
 *  - Max Drawdown (Rupees & %)
 *  - Annualized Sharpe Ratio & Sortino Ratio
 *  - Performance breakdown by Market Regime (TRENDING_UP, SIDEWAYS, etc.)
 */

export interface TradeRecord {
  trade_id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price?: number;
  quantity: number;
  entry_time: Date | string;
  exit_time?: Date | string;
  status: 'OPEN' | 'CLOSED';
  exit_reason?: string;
  gross_pnl?: number;
  net_pnl?: number;
  total_costs?: number;
  regime?: string;
  r_multiple?: number;
  holding_period_mins?: number;
}

export interface RegimeMetrics {
  regime: string;
  tradeCount: number;
  winCount: number;
  winRatePct: number;
  netPnl: number;
  avgPnlPerTrade: number;
}

export interface PerformanceSummary {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winCount: number;
  lossCount: number;
  breakEvenCount: number;

  winRatePct: number;        // e.g. 55.4%
  profitFactor: number;      // Gross Profit / Gross Loss (e.g. 1.85)
  netPnl: number;            // Total net profit after all costs (₹)
  grossPnl: number;          // Total profit before costs (₹)
  totalCosts: number;        // All STT, brokerage, exchange fees (₹)

  avgWin: number;            // Avg profit on winning trades (₹)
  avgLoss: number;           // Avg loss on losing trades (₹)
  winLossRatio: number;      // avgWin / avgLoss
  expectancy: number;        // Expected net P&L per trade (₹)

  maxDrawdownAbs: number;    // Peak-to-trough equity drop (₹)
  maxDrawdownPct: number;    // Max drawdown %

  sharpeRatio: number;       // Annualized Sharpe Ratio (Rf = 6.5% G-Sec)
  sortinoRatio: number;      // Annualized Sortino Ratio (Downside std dev)

  regimeBreakdown: Record<string, RegimeMetrics>;
}

export class PerformanceAnalytics {
  private static readonly RISK_FREE_RATE_ANNUAL = 0.065; // 6.5% Indian 10Y G-Sec Yield

  /**
   * Computes comprehensive performance analytics over an array of trades.
   */
  static analyze(trades: TradeRecord[], initialCapital = 1_000_000): PerformanceSummary {
    const closed = trades.filter(t => t.status === 'CLOSED' && t.net_pnl !== undefined);
    const open   = trades.filter(t => t.status === 'OPEN');

    const totalTrades  = trades.length;
    const closedTrades = closed.length;
    const openTrades   = open.length;

    if (closedTrades === 0) {
      return this.emptySummary(totalTrades, openTrades);
    }

    let winCount = 0;
    let lossCount = 0;
    let breakEvenCount = 0;

    let grossProfit = 0;
    let grossLoss = 0;
    let grossPnl = 0;
    let netPnl = 0;
    let totalCosts = 0;

    const returnsPct: number[] = [];
    const downsideReturnsPct: number[] = [];
    const regimeMap = new Map<string, { total: number; wins: number; pnl: number }>();

    // Equity curve tracking for Max Drawdown
    let currentEquity = initialCapital;
    let peakEquity = initialCapital;
    let maxDrawdownAbs = 0;
    let maxDrawdownPct = 0;

    for (const trade of closed) {
      const pnl = trade.net_pnl ?? 0;
      const gross = trade.gross_pnl ?? 0;
      const cost = trade.total_costs ?? 0;
      const costBasis = trade.entry_price * trade.quantity;

      grossPnl += gross;
      netPnl += pnl;
      totalCosts += cost;

      const tradeReturnPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
      returnsPct.push(tradeReturnPct);

      if (pnl > 0) {
        winCount++;
        grossProfit += pnl;
      } else if (pnl < 0) {
        lossCount++;
        grossLoss += Math.abs(pnl);
        downsideReturnsPct.push(tradeReturnPct);
      } else {
        breakEvenCount++;
      }

      // Equity curve update
      currentEquity += pnl;
      if (currentEquity > peakEquity) {
        peakEquity = currentEquity;
      }
      const ddAbs = peakEquity - currentEquity;
      const ddPct = peakEquity > 0 ? (ddAbs / peakEquity) * 100 : 0;

      if (ddAbs > maxDrawdownAbs) maxDrawdownAbs = ddAbs;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

      // Regime breakdown
      const reg = trade.regime || 'UNKNOWN';
      const regStat = regimeMap.get(reg) ?? { total: 0, wins: 0, pnl: 0 };
      regStat.total += 1;
      if (pnl > 0) regStat.wins += 1;
      regStat.pnl += pnl;
      regimeMap.set(reg, regStat);
    }

    const winRatePct = (winCount / closedTrades) * 100;
    const avgWin = winCount > 0 ? grossProfit / winCount : 0;
    const avgLoss = lossCount > 0 ? grossLoss / lossCount : 0;
    const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.99 : 0;

    const winRateFrac = winCount / closedTrades;
    const lossRateFrac = lossCount / closedTrades;
    const expectancy = (winRateFrac * avgWin) - (lossRateFrac * avgLoss);

    // Annualized Sharpe & Sortino Ratios
    const meanReturn = returnsPct.reduce((a, b) => a + b, 0) / closedTrades;
    const dailyRf = (PerformanceAnalytics.RISK_FREE_RATE_ANNUAL / 252) * 100;

    const variance = returnsPct.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / closedTrades;
    const stdDev = Math.sqrt(variance);

    const downsideVariance = downsideReturnsPct.length > 0
      ? downsideReturnsPct.reduce((sum, r) => sum + Math.pow(r - 0, 2), 0) / downsideReturnsPct.length
      : 0;
    const downsideStdDev = Math.sqrt(downsideVariance);

    const annualFactor = Math.sqrt(252);
    const sharpeRatio = stdDev > 0 ? ((meanReturn - dailyRf) / stdDev) * annualFactor : 0;
    const sortinoRatio = downsideStdDev > 0 ? ((meanReturn - dailyRf) / downsideStdDev) * annualFactor : 0;

    // Convert regime map to object
    const regimeBreakdown: Record<string, RegimeMetrics> = {};
    regimeMap.forEach((val, key) => {
      regimeBreakdown[key] = {
        regime: key,
        tradeCount: val.total,
        winCount: val.wins,
        winRatePct: Math.round((val.wins / val.total) * 100),
        netPnl: Math.round(val.pnl),
        avgPnlPerTrade: Math.round(val.pnl / val.total),
      };
    });

    return {
      totalTrades,
      openTrades,
      closedTrades,
      winCount,
      lossCount,
      breakEvenCount,
      winRatePct: Math.round(winRatePct * 10) / 10,
      profitFactor: Math.round(profitFactor * 100) / 100,
      netPnl: Math.round(netPnl),
      grossPnl: Math.round(grossPnl),
      totalCosts: Math.round(totalCosts),
      avgWin: Math.round(avgWin),
      avgLoss: Math.round(avgLoss),
      winLossRatio: Math.round(winLossRatio * 100) / 100,
      expectancy: Math.round(expectancy),
      maxDrawdownAbs: Math.round(maxDrawdownAbs),
      maxDrawdownPct: Math.round(maxDrawdownPct * 10) / 10,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      sortinoRatio: Math.round(sortinoRatio * 100) / 100,
      regimeBreakdown,
    };
  }

  private static emptySummary(totalTrades: number, openTrades: number): PerformanceSummary {
    return {
      totalTrades,
      openTrades,
      closedTrades: 0,
      winCount: 0,
      lossCount: 0,
      breakEvenCount: 0,
      winRatePct: 0,
      profitFactor: 0,
      netPnl: 0,
      grossPnl: 0,
      totalCosts: 0,
      avgWin: 0,
      avgLoss: 0,
      winLossRatio: 0,
      expectancy: 0,
      maxDrawdownAbs: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      regimeBreakdown: {},
    };
  }
}
