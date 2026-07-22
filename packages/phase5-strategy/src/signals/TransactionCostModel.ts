/**
 * packages/phase5-strategy/src/signals/TransactionCostModel.ts
 * Artha AI — NSE Realistic Transaction Cost Model
 *
 * Computes all-in round-trip costs for NSE equity trades:
 * STT, Exchange Transaction Charge, SEBI Turnover Fee,
 * Brokerage, GST, and Stamp Duty.
 *
 * All rates as per NSE/SEBI circulars (2024–25).
 */

export type TradingSegment = 'INTRADAY' | 'DELIVERY';

export interface TradeInputs {
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  segment: TradingSegment;
  brokerageFlatPerOrder?: number;  // Default ₹20 flat (Zerodha/Angel style)
  brokeragePct?: number;           // Alternative: percentage brokerage (e.g. 0.0003)
}

export interface CostBreakdown {
  entryTurnover: number;
  exitTurnover: number;
  totalTurnover: number;

  // Cost components (₹)
  brokerage: number;
  stt: number;
  exchangeTransactionCharge: number;
  sebiTurnoverFee: number;
  gstOnBrokerage: number;
  stampDuty: number;

  totalCost: number;          // Sum of all above
  costPct: number;            // totalCost as % of totalTurnover
  grossPnl: number;           // (exitPrice - entryPrice) × qty for LONG
  netPnl: number;             // grossPnl - totalCost
  breakEvenMoveAbs: number;   // Minimum price move (₹) to cover costs
  breakEvenMovePct: number;   // As % of entry price
}

export class TransactionCostModel {
  // ─────────────────────────────────────────────────────────────
  // NSE Charge Rates (FY 2024-25)
  // ─────────────────────────────────────────────────────────────
  private static readonly EXCHANGE_TXN_CHARGE = 0.0000345; // 0.00345% of turnover
  private static readonly SEBI_FEE            = 0.000001;  // 0.0001% of turnover
  private static readonly GST_RATE            = 0.18;      // 18% on brokerage
  private static readonly STAMP_DUTY_BUY      = 0.00015;   // 0.015% on buy turnover

  // STT rates
  private static readonly STT_INTRADAY_SELL   = 0.00025;   // 0.025% on sell side only
  private static readonly STT_DELIVERY_BOTH   = 0.001;     // 0.10% on both sides

  calculate(trade: TradeInputs): CostBreakdown {
    const entryTurnover = trade.entryPrice * trade.quantity;
    const exitTurnover  = trade.exitPrice  * trade.quantity;
    const totalTurnover = entryTurnover + exitTurnover;

    // 1. Brokerage (flat ₹20 per order × 2 orders, OR % based)
    const flatBrokerage = trade.brokerageFlatPerOrder ?? 20;
    const pctBrokerage  = trade.brokeragePct
      ? totalTurnover * trade.brokeragePct
      : 0;
    const brokerage = trade.brokeragePct
      ? Math.min(pctBrokerage, flatBrokerage * 2)
      : flatBrokerage * 2; // two orders: entry + exit

    // 2. STT
    let stt = 0;
    if (trade.segment === 'INTRADAY') {
      stt = exitTurnover * TransactionCostModel.STT_INTRADAY_SELL;
    } else {
      stt = totalTurnover * TransactionCostModel.STT_DELIVERY_BOTH;
    }

    // 3. Exchange Transaction Charge (on total turnover)
    const exchangeTransactionCharge = totalTurnover * TransactionCostModel.EXCHANGE_TXN_CHARGE;

    // 4. SEBI Turnover Fee
    const sebiTurnoverFee = totalTurnover * TransactionCostModel.SEBI_FEE;

    // 5. GST on brokerage + exchange charges
    const gstOnBrokerage = (brokerage + exchangeTransactionCharge + sebiTurnoverFee)
      * TransactionCostModel.GST_RATE;

    // 6. Stamp Duty (on buy side only)
    const stampDuty = entryTurnover * TransactionCostModel.STAMP_DUTY_BUY;

    const totalCost = brokerage + stt + exchangeTransactionCharge
      + sebiTurnoverFee + gstOnBrokerage + stampDuty;

    const costPct = totalTurnover > 0 ? (totalCost / totalTurnover) * 100 : 0;

    // P&L
    const grossPnl = (trade.exitPrice - trade.entryPrice) * trade.quantity;
    const netPnl   = grossPnl - totalCost;

    // Break-even: minimum price move to recover all costs
    const breakEvenMoveAbs = trade.quantity > 0 ? totalCost / trade.quantity : 0;
    const breakEvenMovePct = trade.entryPrice > 0
      ? (breakEvenMoveAbs / trade.entryPrice) * 100
      : 0;

    return {
      entryTurnover,
      exitTurnover,
      totalTurnover,
      brokerage,
      stt,
      exchangeTransactionCharge,
      sebiTurnoverFee,
      gstOnBrokerage,
      stampDuty,
      totalCost,
      costPct,
      grossPnl,
      netPnl,
      breakEvenMoveAbs,
      breakEvenMovePct,
    };
  }
}
