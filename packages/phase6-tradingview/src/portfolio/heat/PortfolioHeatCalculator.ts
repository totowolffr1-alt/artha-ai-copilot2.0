/**
 * packages/phase6-tradingview/src/portfolio/heat/PortfolioHeatCalculator.ts
 * Artha AI — Phase 6 Risk Engine — Stage 1
 *
 * Portfolio Heat = weighted average pairwise correlation × portfolio concentration
 *
 * High heat (> 0.60) indicates the portfolio is correlated and a new trade
 * would amplify drawdown risk — sizing should be reduced.
 *
 * Heat multiplier applied to qty:
 *   heat ≤ 0.30  → 1.00 (no reduction)
 *   heat ≤ 0.50  → 0.85
 *   heat ≤ 0.70  → 0.70
 *   heat > 0.70  → 0.50
 */

import { PortfolioSnapshot } from '../../types';
import { CorrelationMatrix } from '../correlation/CorrelationMatrix';

export interface HeatResult {
  heat: number;           // [0, 1]
  size_multiplier: number; // [0.50, 1.00]
  avg_correlation: number;
  detail: string;
}

export class PortfolioHeatCalculator {
  constructor(private readonly correlationMatrix: CorrelationMatrix) {}

  calculate(portfolio: PortfolioSnapshot, new_symbol_id: string): HeatResult {
    const symbols = portfolio.positions.map(p => p.symbol_id);
    if (symbols.length === 0) {
      return { heat: 0, size_multiplier: 1.0, avg_correlation: 0, detail: 'Empty portfolio — no heat' };
    }

    // Include the new symbol in the heat calculation
    const all_symbols = [...symbols, new_symbol_id];
    const avg_correlation = this.correlationMatrix.averageCorrelation(all_symbols);

    // Portfolio concentration: how large are individual positions relative to total?
    const total_value = portfolio.positions.reduce((s, p) => s + p.market_value, 0);
    let concentration = 0;
    if (total_value > 0) {
      const weights = portfolio.positions.map(p => p.market_value / total_value);
      // Herfindahl index
      concentration = weights.reduce((s, w) => s + w * w, 0);
    }

    // Portfolio heat = correlation × (1 + concentration)
    const raw_heat = avg_correlation * (1 + concentration);
    const heat = Math.min(1, raw_heat);

    const size_multiplier =
      heat > 0.70 ? 0.50 :
      heat > 0.50 ? 0.70 :
      heat > 0.30 ? 0.85 : 1.00;

    const detail = `avg_corr=${avg_correlation.toFixed(3)} concentration=${concentration.toFixed(3)} heat=${heat.toFixed(3)} multiplier=${size_multiplier}`;

    return { heat, size_multiplier, avg_correlation, detail };
  }
}
