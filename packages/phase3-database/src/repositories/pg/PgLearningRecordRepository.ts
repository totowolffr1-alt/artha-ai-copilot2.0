/**
 * packages/phase3-database/src/repositories/pg/PgLearningRecordRepository.ts
 * Artha AI — Phase 3
 */

import type { Pool } from 'pg';
import type { ILearningRecordRepository } from '../interfaces/ILearningRecordRepository';
import type {
  LearningRecordRow, StrategyPerformanceRow,
  IndicatorPerformanceRow, RegimePerformanceRow,
} from '../../types/domain';
import type { InsertLearningRecord } from '../../types/insert-dtos';

function mapLearningRecordRow(r: Record<string, unknown>): LearningRecordRow {
  const n = (k: string): number | null => r[k] != null ? parseFloat(r[k] as string) : null;
  return {
    record_id:         r['record_id'] as string,
    trade_id:          r['trade_id'] as string,
    signal_id:         (r['signal_id'] as string | null) ?? null,
    symbol_id:         r['symbol_id'] as string,
    regime:            r['regime'] as string,
    features_at_entry: r['features_at_entry'] as LearningRecordRow['features_at_entry'],
    features_at_exit:  (r['features_at_exit'] as LearningRecordRow['features_at_exit']) ?? null,
    predicted_return:  n('predicted_return'),
    actual_return:     parseFloat(r['actual_return'] as string),
    prediction_error:  n('prediction_error'),
    entry_price:       parseFloat(r['entry_price'] as string),
    exit_price:        parseFloat(r['exit_price'] as string),
    realised_pnl:      parseFloat(r['realised_pnl'] as string),
    mae:               parseFloat(r['mae'] as string),
    mfe:               parseFloat(r['mfe'] as string),
    holding_bars:      parseInt(r['holding_bars'] as string, 10),
    was_winner:        r['was_winner'] as boolean,
    kelly_used:        n('kelly_used'),
    kelly_optimal:     n('kelly_optimal'),
    trade_opened_at:   new Date(r['trade_opened_at'] as string),
    trade_closed_at:   new Date(r['trade_closed_at'] as string),
    recorded_at:       new Date(r['recorded_at'] as string),
  };
}

function mapStrategyPerformanceRow(r: Record<string, unknown>): StrategyPerformanceRow {
  const n = (k: string): number | null => r[k] != null ? parseFloat(r[k] as string) : null;
  return {
    perf_id:              r['perf_id'] as string,
    strategy_run_id:      r['strategy_run_id'] as string,
    symbol_id:            (r['symbol_id'] as string | null) ?? null,
    regime:               r['regime'] as string,
    period_start:         new Date(r['period_start'] as string),
    period_end:           new Date(r['period_end'] as string),
    period_type:          r['period_type'] as StrategyPerformanceRow['period_type'],
    total_signals:        parseInt(r['total_signals'] as string, 10),
    acted_signals:        parseInt(r['acted_signals'] as string, 10),
    winning_trades:       parseInt(r['winning_trades'] as string, 10),
    losing_trades:        parseInt(r['losing_trades'] as string, 10),
    win_rate:             parseFloat(r['win_rate'] as string),
    avg_return_pct:       n('avg_return_pct'),
    avg_mae:              n('avg_mae'),
    avg_mfe:              n('avg_mfe'),
    avg_holding_bars:     n('avg_holding_bars'),
    sharpe_ratio:         n('sharpe_ratio'),
    profit_factor:        n('profit_factor'),
    kelly_accuracy:       n('kelly_accuracy'),
    avg_prediction_error: n('avg_prediction_error'),
    regime_fitness:       n('regime_fitness'),
    computed_at:          new Date(r['computed_at'] as string),
  };
}

function mapIndicatorPerformanceRow(r: Record<string, unknown>): IndicatorPerformanceRow {
  const n = (k: string): number | null => r[k] != null ? parseFloat(r[k] as string) : null;
  return {
    indicator_perf_id:   r['indicator_perf_id'] as string,
    strategy_run_id:     r['strategy_run_id'] as string,
    indicator_name:      r['indicator_name'] as string,
    indicator_params:    r['indicator_params'] as string,
    regime:              r['regime'] as string,
    symbol_class:        r['symbol_class'] as string,
    period_start:        new Date(r['period_start'] as string),
    period_end:          new Date(r['period_end'] as string),
    predictive_accuracy: n('predictive_accuracy'),
    signal_contribution: n('signal_contribution'),
    avg_lead_bars:       n('avg_lead_bars'),
    false_positive_rate: n('false_positive_rate'),
    false_negative_rate: n('false_negative_rate'),
    information_ratio:   n('information_ratio'),
    sample_count:        parseInt(r['sample_count'] as string, 10),
    computed_at:         new Date(r['computed_at'] as string),
  };
}

function mapRegimePerformanceRow(r: Record<string, unknown>): RegimePerformanceRow {
  const n = (k: string): number | null => r[k] != null ? parseFloat(r[k] as string) : null;
  return {
    regime_perf_id:     r['regime_perf_id'] as string,
    symbol_id:          (r['symbol_id'] as string | null) ?? null,
    regime:             r['regime'] as string,
    timeframe:          r['timeframe'] as string,
    period_start:       new Date(r['period_start'] as string),
    period_end:         new Date(r['period_end'] as string),
    occurrence_count:   parseInt(r['occurrence_count'] as string, 10),
    avg_duration_bars:  n('avg_duration_bars'),
    avg_return_pct:     n('avg_return_pct'),
    win_rate:           n('win_rate'),
    best_strategy:      (r['best_strategy'] as string | null) ?? null,
    worst_strategy:     (r['worst_strategy'] as string | null) ?? null,
    avg_volatility:     n('avg_volatility'),
    avg_volume_ratio:   n('avg_volume_ratio'),
    indicator_rankings: r['indicator_rankings'] as RegimePerformanceRow['indicator_rankings'],
    computed_at:        new Date(r['computed_at'] as string),
  };
}

export class PgLearningRecordRepository implements ILearningRecordRepository {
  constructor(private readonly pool: Pool) {}

  async insert(record: InsertLearningRecord): Promise<LearningRecordRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO learning_records (
         trade_id, signal_id, symbol_id, regime,
         features_at_entry, features_at_exit, predicted_return, actual_return,
         prediction_error, entry_price, exit_price, realised_pnl, mae, mfe,
         holding_bars, was_winner, kelly_used, kelly_optimal,
         trade_opened_at, trade_closed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING *`,
      [
        record.trade_id,
        record.signal_id ?? null,
        record.symbol_id,
        record.regime,
        JSON.stringify(record.features_at_entry),
        record.features_at_exit ? JSON.stringify(record.features_at_exit) : null,
        record.predicted_return ?? null,
        record.actual_return,
        record.prediction_error ?? null,
        record.entry_price,
        record.exit_price,
        record.realised_pnl,
        record.mae,
        record.mfe,
        record.holding_bars,
        record.was_winner,
        record.kelly_used ?? null,
        record.kelly_optimal ?? null,
        record.trade_opened_at,
        record.trade_closed_at,
      ],
    );
    return mapLearningRecordRow(rows[0]);
  }

  async existsByTradeId(tradeId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM learning_records WHERE trade_id = $1 LIMIT 1`,
      [tradeId],
    );
    return rows.length > 0;
  }

  async findByRegime(regime: string, limit = 1000): Promise<LearningRecordRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM learning_records
       WHERE regime = $1
       ORDER BY trade_closed_at DESC
       LIMIT $2`,
      [regime, limit],
    );
    return rows.map(mapLearningRecordRow);
  }

  async getLatestStrategyPerformance(strategyRunId: string, regime: string): Promise<StrategyPerformanceRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM strategy_performance
       WHERE strategy_run_id = $1 AND regime = $2
       ORDER BY period_end DESC
       LIMIT 1`,
      [strategyRunId, regime],
    );
    return rows.length ? mapStrategyPerformanceRow(rows[0]) : null;
  }

  async getIndicatorPerformance(strategyRunId: string, regime: string): Promise<IndicatorPerformanceRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM indicator_performance
       WHERE strategy_run_id = $1 AND regime = $2
       ORDER BY information_ratio DESC`,
      [strategyRunId, regime],
    );
    return rows.map(mapIndicatorPerformanceRow);
  }

  async getRegimePerformance(regime: string, timeframe: string, symbolId?: string): Promise<RegimePerformanceRow | null> {
    const params: unknown[] = [regime, timeframe];
    let sql = `SELECT * FROM regime_performance WHERE regime = $1 AND timeframe = $2`;
    if (symbolId) {
      params.push(symbolId);
      sql += ` AND symbol_id = $3`;
    } else {
      sql += ` AND symbol_id IS NULL`;
    }
    sql += ` ORDER BY period_end DESC LIMIT 1`;
    const { rows } = await this.pool.query(sql, params);
    return rows.length ? mapRegimePerformanceRow(rows[0]) : null;
  }
}
