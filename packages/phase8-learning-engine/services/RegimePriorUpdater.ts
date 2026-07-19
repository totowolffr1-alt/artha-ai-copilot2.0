/**
 * phase8/services/RegimePriorUpdater.ts
 * Implements IRegimePriorUpdater (phase8-contracts-v1.md §3.6, roadmap Step 12).
 *
 * ⚠ FLAGGED — NOT SPEC-VERIFIED (no formula found in contracts doc or elsewhere):
 *   1. RegimeFitness.components.sharpe_component is hardcoded to 0. No
 *      variance/stddev-of-returns input exists anywhere in LabelledOutcomeDTO
 *      or upstream DTOs to compute a real Sharpe-style ratio from. This is a
 *      placeholder until real volatility data is piped in and a formula is
 *      specified.
 *   2. RegimeFitness.score is an unweighted average of the three components,
 *      clamped to [0,1]. Only the CLAMPING behavior is test-verified
 *      (RegimePriorUpdater.test.ts "boundary" cases) — the interior
 *      combination formula is not pinned down by any test or doc and should
 *      be treated as provisional pending sign-off.
 *
 * Everything else below (win_rate Bayesian blend, avg_return_pct
 * precision-weighted blend, grouping key, indicator ranking, activate()/I-02
 * supersession ordering) is derived directly from and verified against
 * RegimePriorUpdater.test.ts assertions.
 */
import { randomUUID } from 'crypto';
import type { IRegimePriorUpdater } from '../contracts/IRegimePriorUpdater';
import { OrphanedRegimePriorSupersessionError } from '../errors/Phase8Error';
import type { TrainingRunId, RegimePriorId } from '../domain/types';
import type { LabelledOutcomeDTO } from '../dtos/inputs';
import type { IndicatorPerformanceDTO, RegimePriorDTO } from '../dtos/outputs';

const MIN_SAMPLE_SIZE = 30;

interface IRegimePriorRepository {
  save(prior: RegimePriorDTO): Promise<void>;
  updateStatus(regime_prior_id: string, status: string, extra?: Record<string, unknown>): Promise<void>;
  findCurrent(regime_label: string, symbol_id: string | null, timeframe: string): Promise<RegimePriorDTO | null>;
  findAllCurrentForRun(training_run_id: TrainingRunId): Promise<RegimePriorDTO[]>;
}

interface ILogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function groupKey(regime_label: string, symbol_id: string | null, timeframe: string): string {
  return `${regime_label}|${symbol_id}|${timeframe}`;
}

export class RegimePriorUpdater implements IRegimePriorUpdater {
  constructor(
    private readonly repo: IRegimePriorRepository,
    private readonly logger: ILogger
  ) {}

  async compute(
    training_run_id: TrainingRunId,
    corpus: LabelledOutcomeDTO[],
    indicator_perfs: IndicatorPerformanceDTO[]
  ): Promise<RegimePriorDTO[]> {
    if (corpus.length === 0) {
      return [];
    }

    const indicator_rankings = this.buildIndicatorRankings(indicator_perfs);

    const groups = new Map<string, LabelledOutcomeDTO[]>();
    for (const record of corpus) {
      const key = groupKey(record.regime_label, record.symbol_id, record.timeframe);
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(record);
      } else {
        groups.set(key, [record]);
      }
    }

    const results: RegimePriorDTO[] = [];

    for (const records of groups.values()) {
      const { regime_label, symbol_id, timeframe } = records[0];

      try {
        const priorCurrent = await this.repo.findCurrent(regime_label, symbol_id, timeframe);

        const observedWins = records.filter((r) => r.was_winner).length;
        const observedTotal = records.length;
        const observedMeanReturn =
          records.reduce((sum, r) => sum + r.actual_return, 0) / observedTotal;

        const priorWins = priorCurrent?.win_rate.wins ?? 0;
        const priorTotal = priorCurrent?.win_rate.total ?? 0;
        const priorAvgReturn = priorCurrent?.avg_return_pct ?? 0;

        const wins = priorWins + observedWins;
        const total = priorTotal + observedTotal;
        const rate = total > 0 ? wins / total : 0;

        const avg_return_pct =
          priorTotal + observedTotal > 0
            ? (priorAvgReturn * priorTotal + observedMeanReturn * observedTotal) /
              (priorTotal + observedTotal)
            : observedMeanReturn;

        const avg_volatility = this.computeStdDev(
          records.map((r) => r.actual_return),
          observedMeanReturn
        );

        const is_reliable = total >= MIN_SAMPLE_SIZE;

        const win_rate_component = clamp01(rate);
        const sharpe_component = 0; // see file-level flag — not spec-verified
        const avg_return_component = clamp01(0.5 + avg_return_pct);
        const sample_weight = clamp01(total / MIN_SAMPLE_SIZE);
        const score = clamp01((win_rate_component + sharpe_component + avg_return_component) / 3);

        const dto: RegimePriorDTO = {
          regime_prior_id: randomUUID() as RegimePriorId,
          training_run_id,
          regime_label,
          symbol_id,
          timeframe,
          status: 'COMPUTING',
          win_rate: { wins, total, rate, is_reliable },
          avg_return_pct,
          avg_volatility,
          indicator_rankings,
          regime_fitness: {
            score,
            components: {
              win_rate_component,
              sharpe_component,
              avg_return_component,
              sample_weight,
            },
            is_reliable,
          },
          computed_at: new Date(),
          superseded_at: null,
        } as RegimePriorDTO;

        results.push(dto);
      } catch (err) {
        this.logger.error('RegimePriorUpdater.compute: failed for group', {
          regime_label,
          symbol_id,
          timeframe,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    return results;
  }

  async activate(regime_prior: RegimePriorDTO): Promise<void> {
    const current = await this.repo.findCurrent(
      regime_prior.regime_label,
      regime_prior.symbol_id,
      regime_prior.timeframe
    );

    await this.repo.save(regime_prior);

    if (current && current.regime_prior_id !== regime_prior.regime_prior_id) {
      try {
        await this.repo.updateStatus(current.regime_prior_id, 'SUPERSEDED', {
          superseded_at: new Date(),
        });
      } catch (err) {
        this.logger.error('RegimePriorUpdater.activate: supersession failed — orphan guard tripped', {
          regime_label: regime_prior.regime_label,
          symbol_id: regime_prior.symbol_id,
          timeframe: regime_prior.timeframe,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new OrphanedRegimePriorSupersessionError(
          regime_prior.regime_label,
          regime_prior.symbol_id,
          regime_prior.timeframe
        );
      }
    }

    await this.repo.updateStatus(regime_prior.regime_prior_id, 'CURRENT');
  }

  private buildIndicatorRankings(perfs: IndicatorPerformanceDTO[]) {
    return [...perfs]
      .sort((a, b) => b.information_ratio.ratio - a.information_ratio.ratio)
      .map((p, i) => ({
        indicator_name: p.indicator_name,
        indicator_params: JSON.stringify(p.indicator_params),
        information_ratio: p.information_ratio.ratio,
        predictive_accuracy: p.information_ratio.predictive_accuracy,
        rank: i + 1,
      }));
  }

  private computeStdDev(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }
}