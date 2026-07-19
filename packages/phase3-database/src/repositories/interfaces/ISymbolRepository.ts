/**
 * ISymbolRepository.ts — Artha AI Phase 3
 * Central instrument registry access contract.
 */
import type { SymbolRow } from '../../types/domain';
import type { InsertSymbol } from '../../types/insert-dtos';

export interface ISymbolRepository {
  /** Find a symbol by its canonical (exchange, ticker) pair. */
  findByTicker(exchange: string, ticker: string): Promise<SymbolRow | null>;

  /** Find by SmartAPI broker token — used in tick normalizer. */
  findByBrokerToken(brokerToken: string): Promise<SymbolRow | null>;

  /** Find by internal UUID. */
  findById(symbolId: string): Promise<SymbolRow | null>;

  /** Return all active symbols. Used for subscription manager bootstrap. */
  findActive(): Promise<SymbolRow[]>;

  /**
   * Upsert many symbols from SmartAPI instrument master JSON.
   * Conflict target: (exchange, ticker). Updates all fields except symbol_id.
   */
  upsertMany(symbols: InsertSymbol[]): Promise<{ upserted: number; deactivated: number }>;

  /**
   * Soft-delete all symbols NOT in the given set of broker tokens.
   * Called after instrument master sync to deactivate delisted instruments.
   */
  deactivateExcept(activeBrokerTokens: string[]): Promise<number>;
}
