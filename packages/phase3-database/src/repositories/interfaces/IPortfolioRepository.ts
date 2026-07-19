/**
 * IPortfolioRepository.ts — Artha AI Phase 3
 * Portfolio snapshot and equity curve contract.
 */
import type { PortfolioRow, EquityCurveRow, PerformanceMetricsRow } from '../../types/domain';
import type {
  InsertPortfolio, InsertEquityCurvePoint, UpsertPerformanceMetrics,
} from '../../types/insert-dtos';

export interface PortfolioUpdateFields {
  cash_available?:  number;
  unrealised_pnl?:  number;
  realised_pnl?:    number;
  total_value?:     number;
  drawdown_pct?:    number;
  peak_value?:      number;
  snapshot_at?:     Date;
}

export interface IPortfolioRepository {
  insert(portfolio: InsertPortfolio): Promise<PortfolioRow>;

  findById(portfolioId: string): Promise<PortfolioRow | null>;

  /** Find the live portfolio for an account (uses partial unique index). */
  findLive(accountId: string): Promise<PortfolioRow | null>;

  update(portfolioId: string, fields: PortfolioUpdateFields): Promise<void>;

  /** Append an equity curve point. */
  appendEquityCurvePoint(point: InsertEquityCurvePoint): Promise<void>;

  /**
   * Upsert a performance metric row.
   * Conflict target: (portfolio_id, strategy_run_id, period_type, period_start).
   */
  upsertPerformanceMetrics(metrics: UpsertPerformanceMetrics): Promise<void>;

  /** Get latest all_time metrics for a portfolio. */
  getLatestMetrics(
    portfolioId:     string,
    strategyRunId?:  string,
  ): Promise<PerformanceMetricsRow | null>;
}
