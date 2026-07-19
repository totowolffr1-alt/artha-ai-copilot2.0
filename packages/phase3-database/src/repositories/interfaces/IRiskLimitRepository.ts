/**
 * IRiskLimitRepository.ts — Artha AI Phase 3
 * Risk limit lookup contract.
 * Read by Phase 6 RiskValidationPipeline at stages 1-6.
 */
import type { RiskLimitRow } from '../../types/domain';
import type { InsertRiskLimit } from '../../types/insert-dtos';

export interface IRiskLimitRepository {
  /** Get active limit by type for an account. Sub-millisecond via partial index. */
  findByType(accountId: string, limitType: string): Promise<RiskLimitRow | null>;

  /** Get all active limits for an account. Loaded on session start. */
  findAll(accountId: string): Promise<RiskLimitRow[]>;

  /** Upsert a limit. Conflict target: (account_id, limit_type) WHERE is_active. */
  upsert(limit: InsertRiskLimit): Promise<RiskLimitRow>;

  /** Deactivate a limit by type. */
  deactivate(accountId: string, limitType: string): Promise<void>;
}
