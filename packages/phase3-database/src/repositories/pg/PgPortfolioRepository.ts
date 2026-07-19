/**
 * packages/phase3-database/src/repositories/pg/PgPortfolioRepository.ts
 * Artha AI — Phase 3
 */

import type { Pool } from 'pg';
import type { IPortfolioRepository, PortfolioUpdateFields } from '../interfaces/IPortfolioRepository';
import type { PortfolioRow, EquityCurveRow, PerformanceMetricsRow, PeriodType } from '../../types/domain';
import type { InsertPortfolio, InsertEquityCurvePoint, UpsertPerformanceMetrics } from '../../types/insert-dtos';

function mapPortfolio(r: Record<string, unknown>): PortfolioRow {
  return {
    portfolio_id:      r['portfolio_id'] as string,
    account_id:        r['account_id'] as string,
    name:              r['name'] as string,
    mode:              r['mode'] as PortfolioRow['mode'],
    allocated_capital: parseFloat(r['allocated_capital'] as string),
    cash_available:    parseFloat(r['cash_available'] as string),
    unrealised_pnl:    parseFloat(r['unrealised_pnl'] as string),
    realised_pnl:      parseFloat(r['realised_pnl'] as string),
    total_value:       parseFloat(r['total_value'] as string),
    drawdown_pct:      parseFloat(r['drawdown_pct'] as string),
    peak_value:        parseFloat(r['peak_value'] as string),
    snapshot_at:       new Date(r['snapshot_at'] as string),
    created_at:        new Date(r['created_at'] as string),
  };
}

function mapMetrics(r: Record<string, unknown>): PerformanceMetricsRow {
  const n = (k: string): number | null => r[k] != null ? parseFloat(r[k] as string) : null;
  return {
    metric_id:        r['metric_id'] as string,
    portfolio_id:     r['portfolio_id'] as string,
    strategy_run_id:  (r['strategy_run_id'] as string | null) ?? null,
    period_start:     new Date(r['period_start'] as string),
    period_end:       new Date(r['period_end'] as string),
    period_type:      r['period_type'] as PeriodType,
    total_return_pct: n('total_return_pct'),
    cagr_pct:         n('cagr_pct'),
    sharpe_ratio:     n('sharpe_ratio'),
    sortino_ratio:    n('sortino_ratio'),
    calmar_ratio:     n('calmar_ratio'),
    max_drawdown_pct: parseFloat(r['max_drawdown_pct'] as string),
    max_drawdown_abs: parseFloat(r['max_drawdown_abs'] as string),
    win_rate:         n('win_rate'),
    profit_factor:    n('profit_factor'),
    avg_win:          n('avg_win'),
    avg_loss:         n('avg_loss'),
    expectancy:       n('expectancy'),
    avg_rrr:          n('avg_rrr'),
    total_trades:     parseInt(r['total_trades'] as string, 10),
    winning_trades:   parseInt(r['winning_trades'] as string, 10),
    losing_trades:    parseInt(r['losing_trades'] as string, 10),
    commission_total: parseFloat(r['commission_total'] as string),
    slippage_total:   parseFloat(r['slippage_total'] as string),
    computed_at:      new Date(r['computed_at'] as string),
  };
}

export class PgPortfolioRepository implements IPortfolioRepository {
  constructor(private readonly pool: Pool) {}

  async insert(portfolio: InsertPortfolio): Promise<PortfolioRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO portfolios (account_id, name, mode, allocated_capital, cash_available)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [portfolio.account_id, portfolio.name, portfolio.mode,
       portfolio.allocated_capital, portfolio.cash_available ?? 0],
    );
    return mapPortfolio(rows[0]);
  }

  async findById(portfolioId: string): Promise<PortfolioRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM portfolios WHERE portfolio_id = $1`, [portfolioId],
    );
    return rows.length ? mapPortfolio(rows[0]) : null;
  }

  async findLive(accountId: string): Promise<PortfolioRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM portfolios WHERE account_id = $1 AND mode = 'live' LIMIT 1`, [accountId],
    );
    return rows.length ? mapPortfolio(rows[0]) : null;
  }

  async update(portfolioId: string, fields: PortfolioUpdateFields): Promise<void> {
    const sets: string[] = ['snapshot_at = now()'];
    const values: unknown[] = [];
    let idx = 1;
    const add = (col: string, val: unknown): void => {
      sets.push(`${col} = $${idx}`); values.push(val); idx++;
    };
    if (fields.cash_available  !== undefined) add('cash_available',  fields.cash_available);
    if (fields.unrealised_pnl  !== undefined) add('unrealised_pnl',  fields.unrealised_pnl);
    if (fields.realised_pnl    !== undefined) add('realised_pnl',    fields.realised_pnl);
    if (fields.total_value     !== undefined) add('total_value',     fields.total_value);
    if (fields.drawdown_pct    !== undefined) add('drawdown_pct',    fields.drawdown_pct);
    if (fields.peak_value      !== undefined) add('peak_value',      fields.peak_value);
    if (fields.snapshot_at     !== undefined) add('snapshot_at',     fields.snapshot_at);
    values.push(portfolioId);
    await this.pool.query(
      `UPDATE portfolios SET ${sets.join(', ')} WHERE portfolio_id = $${idx}`, values,
    );
  }

  async appendEquityCurvePoint(point: InsertEquityCurvePoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO equity_curve (
         portfolio_id, recorded_at, equity, cash,
         unrealised_pnl, drawdown_pct, drawdown_abs, open_positions, granularity
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        point.portfolio_id, point.recorded_at, point.equity, point.cash,
        point.unrealised_pnl, point.drawdown_pct, point.drawdown_abs,
        point.open_positions ?? 0, point.granularity,
      ],
    );
  }

  async upsertPerformanceMetrics(m: UpsertPerformanceMetrics): Promise<void> {
    await this.pool.query(
      `INSERT INTO performance_metrics (
         portfolio_id, strategy_run_id, period_start, period_end, period_type,
         total_return_pct, cagr_pct, sharpe_ratio, sortino_ratio, calmar_ratio,
         max_drawdown_pct, max_drawdown_abs, win_rate, profit_factor,
         avg_win, avg_loss, expectancy, avg_rrr,
         total_trades, winning_trades, losing_trades, commission_total, slippage_total
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
       )
       ON CONFLICT (portfolio_id, strategy_run_id, period_type, period_start)
       DO UPDATE SET
         total_return_pct = EXCLUDED.total_return_pct,
         sharpe_ratio     = EXCLUDED.sharpe_ratio,
         win_rate         = EXCLUDED.win_rate,
         total_trades     = EXCLUDED.total_trades,
         winning_trades   = EXCLUDED.winning_trades,
         losing_trades    = EXCLUDED.losing_trades,
         commission_total = EXCLUDED.commission_total,
         computed_at      = now()`,
      [
        m.portfolio_id, m.strategy_run_id ?? null, m.period_start, m.period_end, m.period_type,
        m.total_return_pct ?? null, m.cagr_pct ?? null, m.sharpe_ratio ?? null,
        m.sortino_ratio ?? null, m.calmar_ratio ?? null,
        m.max_drawdown_pct ?? 0, m.max_drawdown_abs ?? 0,
        m.win_rate ?? null, m.profit_factor ?? null,
        m.avg_win ?? null, m.avg_loss ?? null, m.expectancy ?? null, m.avg_rrr ?? null,
        m.total_trades ?? 0, m.winning_trades ?? 0, m.losing_trades ?? 0,
        m.commission_total ?? 0, m.slippage_total ?? 0,
      ],
    );
  }

  async getLatestMetrics(portfolioId: string, strategyRunId?: string): Promise<PerformanceMetricsRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM performance_metrics
       WHERE portfolio_id = $1
         AND ($2::uuid IS NULL OR strategy_run_id = $2::uuid)
         AND period_type = 'all_time'
       ORDER BY computed_at DESC LIMIT 1`,
      [portfolioId, strategyRunId ?? null],
    );
    return rows.length ? mapMetrics(rows[0]) : null;
  }
}
