/**
 * packages/phase6-tradingview/src/portfolio/PortfolioRiskEngine.ts
 * Artha AI — Phase 6 Risk Engine — Stage 1
 *
 * Orchestrates overlap detection and portfolio heat calculation.
 * Returns a combined qty adjustment recommendation for Stage 1.
 */

import { PortfolioSnapshot, RiskConfig } from '../types';
import { OverlapDetector } from './overlap/OverlapDetector';
import { PortfolioHeatCalculator } from './heat/PortfolioHeatCalculator';
import { CorrelationMatrix } from './correlation/CorrelationMatrix';

export interface PortfolioRiskResult {
  passed: boolean;
  adjusted_qty: number;
  overlap_type: string;
  heat: number;
  heat_multiplier: number;
  detail: string;
}

export class PortfolioRiskEngine {
  private readonly overlapDetector: OverlapDetector;
  private readonly heatCalculator: PortfolioHeatCalculator;

  constructor(readonly correlationMatrix: CorrelationMatrix) {
    this.overlapDetector = new OverlapDetector();
    this.heatCalculator  = new PortfolioHeatCalculator(correlationMatrix);
  }

  evaluate(
    symbol_id: string,
    ticker: string,
    direction: 'LONG' | 'SHORT',
    qty: number,
    portfolio: PortfolioSnapshot,
    cfg: RiskConfig,
  ): PortfolioRiskResult {
    // Overlap check
    const overlap = this.overlapDetector.detect(symbol_id, direction, portfolio);

    if (overlap.overlap_type === 'opposite_direction') {
      return {
        passed: false,
        adjusted_qty: 0,
        overlap_type: overlap.overlap_type,
        heat: 0,
        heat_multiplier: 0,
        detail: `REJECT: ${overlap.detail}`,
      };
    }

    // Portfolio heat check
    const heatResult = this.heatCalculator.calculate(portfolio, symbol_id);
    const adjusted_qty = Math.floor(qty * heatResult.size_multiplier);
    const final_qty = Math.max(0, adjusted_qty);

    const detail = [
      `overlap=${overlap.overlap_type}`,
      heatResult.detail,
      overlap.overlap_type === 'same_direction' ? `(pyramid: existing=${overlap.existing_qty})` : '',
    ].filter(Boolean).join(' | ');

    return {
      passed: final_qty >= cfg.min_tradeable_qty,
      adjusted_qty: final_qty,
      overlap_type: overlap.overlap_type,
      heat: heatResult.heat,
      heat_multiplier: heatResult.size_multiplier,
      detail,
    };
  }
}
