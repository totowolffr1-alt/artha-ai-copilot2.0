/**
 * packages/phase5-strategy/src/signals/PositionSizer.ts
 * Artha AI — Volatility & Risk-Adjusted Position Sizing Engine
 *
 * Computes position quantities using:
 * 1. Fixed-Fractional Risk Sizing (Risk % per trade divided by stop loss distance)
 * 2. Quarter-Kelly Criterion Cap (0.25 * Full Kelly)
 * 3. Max Capital Exposure Cap (e.g. max 10% portfolio per position)
 * 4. Dynamic Drawdown Scaling (5% DD -> 50% size, 10% DD -> 0 size)
 */

export interface PositionSizeParams {
  portfolioEquity: number;        // Total portfolio value in ₹
  riskPerTradePct?: number;       // Risk fraction per trade (default 0.01 = 1%)
  entryPrice: number;             // LTP at signal emission
  stopLossPrice: number;          // Absolute stop loss price
  atr14: number;                  // Current 14-period ATR
  winRateEstimate?: number;       // Historical win rate [0, 1] (default 0.50)
  winLossRatio?: number;          // Win/Loss ratio (default 1.5)
  currentDrawdownPct?: number;    // Current strategy drawdown [0, 1] (default 0)
  maxCapitalExposurePct?: number; // Max portfolio capital per position (default 0.10 = 10%)
}

export interface PositionSizeResult {
  recommendedQty: number;        // Final integer share/contract quantity
  riskAmount: number;            // Total ₹ risk if stop loss is hit
  capitalRequired: number;       // Total ₹ capital needed for the entry
  kellyFraction: number;         // Quarter-Kelly fraction [0, 0.25]
  drawdownScale: number;         // Scaling factor applied due to drawdown (1.0, 0.5, or 0.0)
  sizingMethod: 'FIXED_RISK' | 'KELLY_CAP' | 'EXPOSURE_CAP' | 'DRAWDOWN_HALT';
}

export class PositionSizer {
  calculate(params: PositionSizeParams): PositionSizeResult {
    const equity = Math.max(0, params.portfolioEquity);
    const riskPct = params.riskPerTradePct ?? 0.01;
    const p = params.winRateEstimate ?? 0.50;
    const b = params.winLossRatio ?? 1.5;
    const maxExposurePct = params.maxCapitalExposurePct ?? 0.10;
    const drawdownPct = params.currentDrawdownPct ?? 0.0;

    // 1. Check Drawdown Circuit Breaker
    let drawdownScale = 1.0;
    if (drawdownPct >= 0.10) {
      // 10%+ Drawdown -> Kill switch, 0 quantity
      return {
        recommendedQty: 0,
        riskAmount: 0,
        capitalRequired: 0,
        kellyFraction: 0,
        drawdownScale: 0.0,
        sizingMethod: 'DRAWDOWN_HALT',
      };
    } else if (drawdownPct >= 0.05) {
      // 5% - 10% Drawdown -> Scale position size by 50%
      drawdownScale = 0.5;
    }

    if (equity === 0 || params.entryPrice <= 0) {
      return {
        recommendedQty: 0,
        riskAmount: 0,
        capitalRequired: 0,
        kellyFraction: 0,
        drawdownScale,
        sizingMethod: 'FIXED_RISK',
      };
    }

    // 2. Risk-Based Sizing (Fixed Fractional)
    const stopDistance = Math.abs(params.entryPrice - params.stopLossPrice);
    const effectiveStopDistance = stopDistance > 0 ? stopDistance : params.atr14 * 2.0;

    const riskBudget = equity * riskPct;
    const rawRiskQty = Math.floor(riskBudget / effectiveStopDistance);

    // 3. Quarter-Kelly Criterion Cap
    // Full Kelly f* = (p * b - (1 - p)) / b
    const rawKelly = (p * b - (1 - p)) / b;
    const quarterKelly = Math.max(0, Math.min(0.25, rawKelly * 0.25));
    const kellyBudget = equity * quarterKelly;
    const rawKellyQty = Math.floor(kellyBudget / params.entryPrice);

    // 4. Max Capital Exposure Cap
    const maxCapitalBudget = equity * maxExposurePct;
    const rawExposureQty = Math.floor(maxCapitalBudget / params.entryPrice);

    // 5. Select binding constraint
    let bindingQty = rawRiskQty;
    let sizingMethod: PositionSizeResult['sizingMethod'] = 'FIXED_RISK';

    if (rawKellyQty < bindingQty && rawKellyQty > 0) {
      bindingQty = rawKellyQty;
      sizingMethod = 'KELLY_CAP';
    }

    if (rawExposureQty < bindingQty) {
      bindingQty = rawExposureQty;
      sizingMethod = 'EXPOSURE_CAP';
    }

    // Apply drawdown scaling
    const finalQty = Math.max(0, Math.floor(bindingQty * drawdownScale));
    const capitalRequired = finalQty * params.entryPrice;
    const riskAmount = finalQty * effectiveStopDistance;

    return {
      recommendedQty: finalQty,
      riskAmount,
      capitalRequired,
      kellyFraction: quarterKelly,
      drawdownScale,
      sizingMethod,
    };
  }
}
