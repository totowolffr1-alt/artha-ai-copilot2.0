/**
 * Dual-Sandbox Paper Trading Engine
 *
 * Two parallel paper trading simulations run simultaneously:
 *
 * SANDBOX A — Micro (₹2,000):
 *   Goal: Train AI/user to survive and compound a tiny account.
 *   Strategy: Equity Delivery only. No options, no intraday.
 *   Focus: Capital protection, minimal friction, patience.
 *
 * SANDBOX B — Macro (₹1,00,000):
 *   Goal: Train AI on full portfolio strategies.
 *   Strategy: Intraday, options spreads, multi-stock hedging.
 *   Focus: Sharpe ratio, drawdown reduction, capital scaling.
 *
 * Both sandboxes feed their trade journals into the EOD Learning Engine.
 */

import { computeThresholds, TradeStrategy } from './dynamicThresholdEngine';

export interface SandboxTrade {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  qty: number;
  price: number;
  strategy: TradeStrategy;
  entryTime: string;
  exitTime?: string;
  exitPrice?: number;
  pnl?: number;
  pnlPct?: number;
  status: 'OPEN' | 'CLOSED' | 'REJECTED';
  rejectionReason?: string;
  thresholdReasoning: string;
  confidence?: number;
  sandbox: 'MICRO' | 'MACRO';
}

export interface SandboxState {
  id: 'MICRO' | 'MACRO';
  label: string;
  initialCapital: number;
  currentCapital: number;
  availableCash: number;
  investedValue: number;
  totalPnL: number;
  totalPnLPct: number;
  trades: SandboxTrade[];
  openPositions: SandboxTrade[];
  winCount: number;
  lossCount: number;
  winRate: number;
  maxDrawdown: number;
  peakCapital: number;
  allowedStrategies: TradeStrategy[];
  createdAt: string;
}

let tradeCounter = 1;

function generateTradeId(sandbox: 'MICRO' | 'MACRO'): string {
  return `${sandbox}-TRD-${Date.now()}-${tradeCounter++}`;
}

// ── Initialize Sandbox States ──────────────────────────────────────────────────

export const MICRO_SANDBOX: SandboxState = {
  id: 'MICRO',
  label: 'Micro Sandbox (₹2,000)',
  initialCapital: 2000,
  currentCapital: 2000,
  availableCash: 2000,
  investedValue: 0,
  totalPnL: 0,
  totalPnLPct: 0,
  trades: [],
  openPositions: [],
  winCount: 0,
  lossCount: 0,
  winRate: 0,
  maxDrawdown: 0,
  peakCapital: 2000,
  allowedStrategies: ['DELIVERY', 'SWING'],  // only low-cost strategies
  createdAt: new Date().toISOString(),
};

export const MACRO_SANDBOX: SandboxState = {
  id: 'MACRO',
  label: 'Macro Sandbox (₹1,00,000)',
  initialCapital: 100000,
  currentCapital: 100000,
  availableCash: 100000,
  investedValue: 0,
  totalPnL: 0,
  totalPnLPct: 0,
  trades: [],
  openPositions: [],
  winCount: 0,
  lossCount: 0,
  winRate: 0,
  maxDrawdown: 0,
  peakCapital: 100000,
  allowedStrategies: ['DELIVERY', 'INTRADAY', 'OPTIONS', 'SWING'],
  createdAt: new Date().toISOString(),
};

// ── Place Trade in a Sandbox ───────────────────────────────────────────────────

export function placeSandboxTrade(
  sandbox: SandboxState,
  symbol: string,
  direction: 'BUY' | 'SELL',
  qty: number,
  price: number,
  strategy: TradeStrategy,
  confidence?: number,
  vix = 15,
  regime = 'NEUTRAL',
): SandboxTrade {

  // Check if strategy is allowed in this sandbox
  if (!sandbox.allowedStrategies.includes(strategy)) {
    const trade: SandboxTrade = {
      id: generateTradeId(sandbox.id),
      symbol,
      direction,
      qty,
      price,
      strategy,
      entryTime: new Date().toISOString(),
      status: 'REJECTED',
      rejectionReason: `${strategy} not allowed in ${sandbox.label}. Allowed: ${sandbox.allowedStrategies.join(', ')}`,
      thresholdReasoning: 'Strategy blocked by sandbox config',
      confidence,
      sandbox: sandbox.id,
    };
    sandbox.trades.push(trade);
    return trade;
  }

  // Run dynamic threshold check
  const threshold = computeThresholds(sandbox.availableCash, strategy, price, vix, regime);
  const tradeValue = qty * price;

  if (threshold.decision === 'BLOCK') {
    const trade: SandboxTrade = {
      id: generateTradeId(sandbox.id),
      symbol,
      direction,
      qty,
      price,
      strategy,
      entryTime: new Date().toISOString(),
      status: 'REJECTED',
      rejectionReason: threshold.reasoning,
      thresholdReasoning: threshold.reasoning,
      confidence,
      sandbox: sandbox.id,
    };
    sandbox.trades.push(trade);
    return trade;
  }

  // Check available cash for BUY
  if (direction === 'BUY' && tradeValue > sandbox.availableCash) {
    const adjustedQty = Math.floor(sandbox.availableCash / price);
    if (adjustedQty <= 0) {
      const trade: SandboxTrade = {
        id: generateTradeId(sandbox.id),
        symbol, direction, qty, price, strategy,
        entryTime: new Date().toISOString(),
        status: 'REJECTED',
        rejectionReason: `Insufficient cash. Available: ₹${sandbox.availableCash.toFixed(2)}, needed: ₹${tradeValue.toFixed(2)}`,
        thresholdReasoning: threshold.reasoning,
        confidence,
        sandbox: sandbox.id,
      };
      sandbox.trades.push(trade);
      return trade;
    }
    qty = adjustedQty; // auto-adjust to available cash
  }

  const finalTradeValue = qty * price;

  // Execute the trade
  const trade: SandboxTrade = {
    id: generateTradeId(sandbox.id),
    symbol,
    direction,
    qty,
    price,
    strategy,
    entryTime: new Date().toISOString(),
    status: 'OPEN',
    thresholdReasoning: threshold.reasoning,
    confidence,
    sandbox: sandbox.id,
  };

  // Update sandbox state
  if (direction === 'BUY') {
    sandbox.availableCash -= finalTradeValue;
    sandbox.investedValue += finalTradeValue;
    sandbox.openPositions.push(trade);
  } else {
    // SELL — find matching open position
    const openIdx = sandbox.openPositions.findIndex(p => p.symbol === symbol && p.direction === 'BUY');
    if (openIdx !== -1) {
      const openTrade = sandbox.openPositions[openIdx];
      const pnl = (price - openTrade.price) * Math.min(qty, openTrade.qty);
      const pnlPct = ((price - openTrade.price) / openTrade.price) * 100;

      trade.exitPrice = openTrade.price;
      trade.pnl = parseFloat(pnl.toFixed(2));
      trade.pnlPct = parseFloat(pnlPct.toFixed(2));
      trade.status = 'CLOSED';
      trade.exitTime = new Date().toISOString();

      sandbox.availableCash += finalTradeValue + pnl;
      sandbox.investedValue -= openTrade.qty * openTrade.price;
      sandbox.totalPnL += pnl;

      if (pnl >= 0) sandbox.winCount++; else sandbox.lossCount++;
      sandbox.openPositions.splice(openIdx, 1);
    } else {
      trade.status = 'REJECTED';
      trade.rejectionReason = `No open BUY position found for ${symbol} to sell against.`;
    }
  }

  // Recalculate totals
  sandbox.currentCapital = sandbox.availableCash + sandbox.investedValue + sandbox.totalPnL;
  sandbox.totalPnLPct = parseFloat(((sandbox.currentCapital - sandbox.initialCapital) / sandbox.initialCapital * 100).toFixed(2));
  sandbox.winRate = (sandbox.winCount + sandbox.lossCount) > 0
    ? parseFloat((sandbox.winCount / (sandbox.winCount + sandbox.lossCount) * 100).toFixed(1))
    : 0;

  // Track peak capital & max drawdown
  if (sandbox.currentCapital > sandbox.peakCapital) {
    sandbox.peakCapital = sandbox.currentCapital;
  }
  const drawdown = (sandbox.peakCapital - sandbox.currentCapital) / sandbox.peakCapital * 100;
  if (drawdown > sandbox.maxDrawdown) sandbox.maxDrawdown = parseFloat(drawdown.toFixed(2));

  sandbox.trades.push(trade);
  console.log(`[${sandbox.id} Sandbox] ${direction} ${qty}×${symbol} @ ₹${price} → ${trade.status} | Cash: ₹${sandbox.availableCash.toFixed(2)}`);

  return trade;
}

// ── Get Sandbox Summary ────────────────────────────────────────────────────────
export function getSandboxSummary(sandbox: SandboxState) {
  return {
    id: sandbox.id,
    label: sandbox.label,
    initialCapital: sandbox.initialCapital,
    currentCapital: parseFloat(sandbox.currentCapital.toFixed(2)),
    availableCash: parseFloat(sandbox.availableCash.toFixed(2)),
    investedValue: parseFloat(sandbox.investedValue.toFixed(2)),
    totalPnL: parseFloat(sandbox.totalPnL.toFixed(2)),
    totalPnLPct: sandbox.totalPnLPct,
    openPositions: sandbox.openPositions.length,
    totalTrades: sandbox.trades.length,
    winCount: sandbox.winCount,
    lossCount: sandbox.lossCount,
    winRate: sandbox.winRate,
    maxDrawdown: sandbox.maxDrawdown,
    peakCapital: parseFloat(sandbox.peakCapital.toFixed(2)),
    allowedStrategies: sandbox.allowedStrategies,
  };
}

// ── Reset Sandbox ─────────────────────────────────────────────────────────────
export function resetSandbox(sandbox: SandboxState): void {
  const initial = sandbox.initialCapital;
  sandbox.currentCapital = initial;
  sandbox.availableCash = initial;
  sandbox.investedValue = 0;
  sandbox.totalPnL = 0;
  sandbox.totalPnLPct = 0;
  sandbox.trades = [];
  sandbox.openPositions = [];
  sandbox.winCount = 0;
  sandbox.lossCount = 0;
  sandbox.winRate = 0;
  sandbox.maxDrawdown = 0;
  sandbox.peakCapital = initial;
  console.log(`[Sandbox] ${sandbox.label} reset to ₹${initial}`);
}
