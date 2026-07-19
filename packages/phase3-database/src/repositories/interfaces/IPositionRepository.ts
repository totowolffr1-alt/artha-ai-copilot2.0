/**
 * IPositionRepository.ts — Artha AI Phase 3
 * Trade-scoped position tracking contract.
 */
import type { PositionRow, PositionStatus } from '../../types/domain';
import type { InsertPosition } from '../../types/insert-dtos';

export interface PositionUpdateFields {
  qty?:            number;
  ltp?:            number;
  unrealised_pnl?: number;
  realised_pnl?:   number;
  mtm_value?:      number;
  margin_blocked?: number;
  status?:         PositionStatus;
  closed_at?:      Date;
}

export interface IPositionRepository {
  insert(position: InsertPosition): Promise<PositionRow>;

  findById(positionId: string): Promise<PositionRow | null>;

  /** Find by trade — 1-to-1 relationship. */
  findByTrade(tradeId: string): Promise<PositionRow | null>;

  /**
   * All open/partial positions for a portfolio.
   * Uses idx_positions_active partial index — sub-millisecond.
   */
  findActive(portfolioId: string): Promise<PositionRow[]>;

  /**
   * Active positions for a specific symbol across a portfolio.
   * Fires on every tick for subscribed symbols.
   */
  findActiveBySymbol(symbolId: string, portfolioId: string): Promise<PositionRow[]>;

  update(positionId: string, fields: PositionUpdateFields): Promise<void>;
}
