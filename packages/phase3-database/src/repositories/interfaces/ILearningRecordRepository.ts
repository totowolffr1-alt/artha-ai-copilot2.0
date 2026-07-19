/**
 * ILearningRecordRepository.ts — Artha AI Phase 3
 * Training corpus and performance aggregates contract.
 * Consumed by Phase 8 Learning Engine.
 */
import type {
  LearningRecordRow, StrategyPerformanceRow,
  IndicatorPerformanceRow, RegimePerformanceRow,
} from '../../types/domain';
import type { InsertLearningRecord } from '../../types/insert-dtos';

export interface ILearningRecordRepository {
  /**
   * Insert a learning record atomically on trade close.
   * Must be called inside the same transaction as the trade status update.
   * Append-only — no updates after insert.
   */
  insert(record: InsertLearningRecord): Promise<LearningRecordRow>;

  /** Check if a learning record already exists for a trade. */
  existsByTradeId(tradeId: string): Promise<boolean>;

  /** Fetch records for model training — filtered by regime. */
  findByRegime(regime: string, limit?: number): Promise<LearningRecordRow[]>;

  /**
   * Strategy performance for signal engine regime weighting.
   * ORDER BY period_end DESC LIMIT 1 — never use jsonb_array_elements on hot path.
   */
  getLatestStrategyPerformance(
    strategyRunId: string,
    regime:        string,
  ): Promise<StrategyPerformanceRow | null>;

  /**
   * Indicator information ratios for a strategy run.
   * Used by signal engine to prune low-IR indicators.
   */
  getIndicatorPerformance(
    strategyRunId: string,
    regime:        string,
  ): Promise<IndicatorPerformanceRow[]>;

  /**
   * Regime performance including indicator_rankings JSONB.
   * Regime detector reads this to select features for next classification pass.
   */
  getRegimePerformance(
    regime:    string,
    timeframe: string,
    symbolId?: string,
  ): Promise<RegimePerformanceRow | null>;
}
