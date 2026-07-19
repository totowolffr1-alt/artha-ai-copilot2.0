/**
 * ITradeRepository.ts — Artha AI Phase 3
 * Logical trade lifecycle contract.
 */
import type { TradeRow, TradeStatus, CloseReason } from '../../types/domain';
import type { InsertTrade } from '../../types/insert-dtos';

export interface TradeUpdateFields {
  status?:          TradeStatus;
  filled_qty?:      number;
  avg_entry_price?: number;
  avg_exit_price?:  number;
  realised_pnl?:    number;
  commission?:      number;
  slippage?:        number;
  close_reason?:    CloseReason;
  opened_at?:       Date;
  closed_at?:       Date;
}

export interface ITradeRepository {
  /** Insert a new trade record. Returns the created row. */
  insert(trade: InsertTrade): Promise<TradeRow>;

  /** Find by internal UUID. */
  findById(tradeId: string): Promise<TradeRow | null>;

  /** All open/partial trades for an account (hot path — uses partial index). */
  findOpen(accountId: string): Promise<TradeRow[]>;

  /** Trades by signal — used to check if signal already acted. */
  findBySignal(signalId: string): Promise<TradeRow[]>;

  /**
   * Update trade fields atomically.
   * updated_at is always refreshed by the repo.
   */
  update(tradeId: string, fields: TradeUpdateFields): Promise<void>;

  /**
   * Range query for P&L analytics.
   * Includes INCLUDE columns (realised_pnl, commission, slippage).
   */
  findByAccountAndMode(
    accountId: string,
    mode:      string,
    from?:     Date,
    to?:       Date,
  ): Promise<TradeRow[]>;
}
