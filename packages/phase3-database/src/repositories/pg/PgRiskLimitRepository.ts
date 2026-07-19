/**
 * packages/phase3-database/src/repositories/pg/PgRiskLimitRepository.ts
 * Artha AI — Phase 3
 */

import type { Pool } from 'pg';
import type { IRiskLimitRepository } from '../interfaces/IRiskLimitRepository';
import type { RiskLimitRow } from '../../types/domain';
import type { InsertRiskLimit } from '../../types/insert-dtos';

function mapRow(r: Record<string, unknown>): RiskLimitRow {
  return {
    limit_id:    r['limit_id'] as string,
    account_id:  r['account_id'] as string,
    limit_type:  r['limit_type'] as string,
    limit_value: parseFloat(r['limit_value'] as string),
    is_active:   r['is_active'] as boolean,
    updated_at:  new Date(r['updated_at'] as string),
  };
}

export class PgRiskLimitRepository implements IRiskLimitRepository {
  constructor(private readonly pool: Pool) {}

  async findByType(accountId: string, limitType: string): Promise<RiskLimitRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM risk_limits
       WHERE account_id = $1 AND limit_type = $2 AND is_active = true
       LIMIT 1`,
      [accountId, limitType],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findAll(accountId: string): Promise<RiskLimitRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM risk_limits
       WHERE account_id = $1 AND is_active = true`,
      [accountId],
    );
    return rows.map(mapRow);
  }

  async upsert(limit: InsertRiskLimit): Promise<RiskLimitRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO risk_limits (account_id, limit_type, limit_value, is_active)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, limit_type) WHERE is_active = true
       DO UPDATE SET
         limit_value = EXCLUDED.limit_value,
         updated_at = now()
       RETURNING *`,
      [
        limit.account_id,
        limit.limit_type,
        limit.limit_value,
        limit.is_active ?? true,
      ],
    );
    return mapRow(rows[0]);
  }

  async deactivate(accountId: string, limitType: string): Promise<void> {
    await this.pool.query(
      `UPDATE risk_limits
       SET is_active = false, updated_at = now()
       WHERE account_id = $1 AND limit_type = $2 AND is_active = true`,
      [accountId, limitType],
    );
  }
}
