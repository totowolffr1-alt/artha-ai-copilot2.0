/**
 * packages/phase6-tradingview/src/portfolio/overlap/OverlapDetector.ts
 * Artha AI — Phase 6 Risk Engine — Stage 1
 *
 * Detects if the new signal's symbol is already held in the portfolio
 * (double-entry prevention) or if the direction conflicts with an
 * existing position in the same symbol.
 */

import { PortfolioSnapshot } from '../../types';

export type OverlapType = 'none' | 'same_direction' | 'opposite_direction';

export interface OverlapResult {
  overlap_type: OverlapType;
  existing_qty?: number;
  existing_direction?: string;
  detail: string;
}

export class OverlapDetector {
  detect(
    symbol_id: string,
    new_direction: 'LONG' | 'SHORT',
    portfolio: PortfolioSnapshot,
  ): OverlapResult {
    const existing = portfolio.positions.find(p => p.symbol_id === symbol_id);

    if (!existing) {
      return { overlap_type: 'none', detail: 'No existing position' };
    }

    if (existing.direction === new_direction) {
      return {
        overlap_type: 'same_direction',
        existing_qty: existing.qty,
        existing_direction: existing.direction,
        detail: `Already ${existing.direction} ${existing.qty} shares — pyramid check required`,
      };
    }

    return {
      overlap_type: 'opposite_direction',
      existing_qty: existing.qty,
      existing_direction: existing.direction,
      detail: `Conflicting direction: holding ${existing.direction}, signal wants ${new_direction}`,
    };
  }
}
