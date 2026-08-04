/**
 * Dynamic Threshold Engine
 *
 * Replaces all hardcoded capital constraints with AI-computed thresholds.
 * The AI dynamically calculates min/max trade size based on:
 *  - Available capital
 *  - Transaction cost for the chosen strategy
 *  - Current market volatility (VIX/regime)
 *  - Stock-specific volatility (price range)
 */

export type TradeStrategy = 'DELIVERY' | 'INTRADAY' | 'OPTIONS' | 'SWING';
export type TradeDecision = 'LIVE' | 'PAPER' | 'BLOCK';

export interface ThresholdResult {
  decision: TradeDecision;
  strategy: TradeStrategy;
  minCapital: number;
  maxCapital: number;
  transactionCost: number;
  targetProfitPct: number;
  reasoning: string;
  positionSizeQty: number;
  positionSizeValue: number;
}

// ── Transaction cost table (Angel One) ────────────────────────────────────────
const TRANSACTION_COSTS: Record<TradeStrategy, number> = {
  DELIVERY: 0,      // ₹0 brokerage on Angel One for equity delivery
  INTRADAY: 20,     // ₹20 flat per order
  OPTIONS:  20,     // ₹20 flat per order
  SWING:    0,      // Treated as delivery for multi-day
};

// Target profit % per strategy (conservative)
const TARGET_PROFIT_PCT: Record<TradeStrategy, number> = {
  DELIVERY: 0.05,   // 5% target for delivery swing
  INTRADAY: 0.01,   // 1% target for intraday
  OPTIONS:  0.15,   // 15% target for options
  SWING:    0.05,   // 5% target for multi-day swing
};

// Max portfolio exposure per strategy
const MAX_EXPOSURE_PCT: Record<TradeStrategy, number> = {
  DELIVERY: 0.50,   // up to 50% of capital in delivery (low risk)
  INTRADAY: 0.20,   // up to 20% of capital in intraday
  OPTIONS:  0.10,   // up to 10% of capital in options
  SWING:    0.30,   // up to 30% of capital in swing
};

// VIX-based risk multiplier
function getVixMultiplier(vix: number): number {
  if (vix < 12) return 1.25;     // Very low vol — can take more risk
  if (vix < 15) return 1.0;      // Normal — standard thresholds
  if (vix < 20) return 0.75;     // Elevated — reduce exposure
  if (vix < 25) return 0.5;      // High — conservative
  return 0.25;                    // Crisis — very small positions only
}

/**
 * Core dynamic threshold calculator.
 * Called before every trade to determine: LIVE / PAPER / BLOCK
 */
export function computeThresholds(
  availableCapital: number,
  strategy: TradeStrategy,
  stockPrice: number,
  vix: number = 15,
  regime: string = 'NEUTRAL',
): ThresholdResult {
  const txCost = TRANSACTION_COSTS[strategy];
  const targetPct = TARGET_PROFIT_PCT[strategy];
  const maxExposurePct = MAX_EXPOSURE_PCT[strategy];
  const vixMult = getVixMultiplier(vix);

  // Dynamic minimum capital formula:
  // minCapital = transactionCost / targetProfitPct
  // For DELIVERY (₹0 tx cost), use a floor of ₹100 (meaningful position)
  const minCapital = txCost > 0
    ? Math.ceil(txCost / targetPct)
    : 100;

  // Dynamic maximum capital: % of available capital, adjusted for volatility
  const maxCapital = Math.floor(availableCapital * maxExposurePct * vixMult);

  // Determine trade decision
  let decision: TradeDecision;
  let reasoning: string;

  if (availableCapital < minCapital) {
    decision = 'BLOCK';
    reasoning = `Insufficient capital. Need ₹${minCapital} min for ${strategy}. Available: ₹${availableCapital.toFixed(0)}.`;
  } else if (strategy === 'DELIVERY') {
    // Delivery is always LIVE — ₹0 brokerage means even tiny amounts are profitable
    decision = 'LIVE';
    reasoning = `Delivery trade — ₹0 brokerage on Angel One. Min capital: ₹${minCapital}. Going LIVE.`;
  } else if (availableCapital >= minCapital) {
    decision = 'LIVE';
    reasoning = `Capital ₹${availableCapital.toFixed(0)} >= min ₹${minCapital} for ${strategy}. VIX=${vix} (mult=${vixMult}). Going LIVE.`;
  } else {
    decision = 'PAPER';
    reasoning = `Capital ₹${availableCapital.toFixed(0)} below min ₹${minCapital} for ${strategy}. Routing to PAPER sandbox.`;
  }

  // Bear market override — force PAPER for risky strategies
  if (regime.includes('BEAR') && strategy === 'OPTIONS') {
    decision = 'PAPER';
    reasoning += ` [BEAR regime detected — OPTIONS forced to PAPER]`;
  }

  // Calculate optimal position size
  const tradeCapital = Math.min(availableCapital * 0.2, maxCapital); // risk max 20% per trade
  const positionSizeQty = stockPrice > 0 ? Math.floor(tradeCapital / stockPrice) : 0;
  const positionSizeValue = positionSizeQty * stockPrice;

  return {
    decision,
    strategy,
    minCapital,
    maxCapital,
    transactionCost: txCost,
    targetProfitPct: targetPct * 100,
    reasoning,
    positionSizeQty,
    positionSizeValue: parseFloat(positionSizeValue.toFixed(2)),
  };
}

/**
 * Quick helper used in order flow:
 * Given capital + strategy, should this order go LIVE or PAPER?
 */
export function shouldGoLive(
  availableCapital: number,
  strategy: TradeStrategy,
  stockPrice: number,
  vix = 15,
  regime = 'NEUTRAL',
): boolean {
  const result = computeThresholds(availableCapital, strategy, stockPrice, vix, regime);
  return result.decision === 'LIVE';
}
