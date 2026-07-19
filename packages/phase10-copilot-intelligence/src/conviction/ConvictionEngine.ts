import {
  ConfidenceScoreInput,
  ConfidenceScore,
  ConfidenceFactorScore,
  ConfidenceFactorWeight,
  ConfidenceBand,
  IConfidenceScoreCalculator,
  ExternalMarketRiskContext,
  ExternalHistoricalPerformanceStats,
  bandForScore,
  assertValidWeights,
  isPlaceholderRiskContext,
} from '../contracts';

/**
 * Phase 10B — ConvictionEngine
 * =============================
 * Concrete implementation of the Phase 10A `IConfidenceScoreCalculator`
 * contract. Imports ONLY from `phase10/contracts` — no path outside
 * `src/phase10` exists in this repository to import from (verified before
 * writing this file), so this module has zero coupling to Phase 2/5/6/8.
 *
 * WEIGHT PROFILE STRATEGY
 * ------------------------
 * The set of active factors varies by what optional context is supplied:
 *   - base only (signal + regime)
 *   - base + risk context
 *   - base + historical stats
 *   - base + risk + historical stats
 * Each profile has its own fixed weight set (all sum to 1.0, enforced by
 * `assertValidWeights`). This avoids silently reweighting in a way that's
 * hard to reason about — the profile a given score used is always
 * recoverable from which factorIds appear in `ConfidenceScore.factors`.
 *
 * COLD-START RULE
 * ----------------
 * Historical stats are only treated as usable signal when the sample size
 * meets `MIN_SAMPLE_SIZE_FOR_HISTORY`. Below that, a few trades reveal
 * nothing that trustworthy about a strategy's real hit rate, and using them
 * anyway would let a lucky-or-unlucky flag flurry swing the reported
 * confidence. Below-threshold stats are treated as absent, not zeroed out.
 */

export const MIN_SAMPLE_SIZE_FOR_HISTORY = 20;

type WeightProfileKey = 'base' | 'base_risk' | 'base_history' | 'base_risk_history';

const WEIGHT_PROFILES: Record<WeightProfileKey, ReadonlyArray<ConfidenceFactorWeight>> = {
  base: [
    { factorId: 'signal_strength', weight: 0.6 },
    { factorId: 'regime_alignment', weight: 0.4 },
  ],
  base_risk: [
    { factorId: 'signal_strength', weight: 0.45 },
    { factorId: 'regime_alignment', weight: 0.3 },
    { factorId: 'risk_penalty', weight: 0.25 },
  ],
  base_history: [
    { factorId: 'signal_strength', weight: 0.45 },
    { factorId: 'regime_alignment', weight: 0.3 },
    { factorId: 'historical_track_record', weight: 0.25 },
  ],
  base_risk_history: [
    { factorId: 'signal_strength', weight: 0.35 },
    { factorId: 'regime_alignment', weight: 0.25 },
    { factorId: 'risk_penalty', weight: 0.2 },
    { factorId: 'historical_track_record', weight: 0.2 },
  ],
};

// Every profile must sum to 1.0 — checked once at module load, not per-call,
// since the profiles themselves are static constants.
Object.entries(WEIGHT_PROFILES).forEach(([key, weights]) => {
  try {
    assertValidWeights(weights);
  } catch (err) {
    throw new Error(`Invalid static weight profile "${key}": ${(err as Error).message}`);
  }
});

/** Maps risk level + volatility percentile to a 0..100 "safety score" (100 = safest). */
function riskLevelBaseSafety(riskLevel: ExternalMarketRiskContext['riskLevel']): number {
  switch (riskLevel) {
    case 'low':
      return 90;
    case 'medium':
      return 65;
    case 'high':
      return 35;
    case 'extreme':
      return 10;
  }
}

export class ConvictionEngine implements IConfidenceScoreCalculator {
  calculate(input: ConfidenceScoreInput): ConfidenceScore {
    this.validateInput(input);

    const usableHistory = this.usableHistoricalStats(input.historicalStats);
    const profileKey = this.selectProfile(input.marketRiskContext, usableHistory);
    const weights = WEIGHT_PROFILES[profileKey];

    const factors: ConfidenceFactorScore[] = [];
    for (const w of weights) {
      switch (w.factorId) {
        case 'signal_strength':
          factors.push(this.buildSignalFactor(input.signalStrength, w.weight));
          break;
        case 'regime_alignment':
          factors.push(this.buildRegimeFactor(input.regimeAlignment, w.weight));
          break;
        case 'risk_penalty':
          factors.push(this.buildRiskFactor(input.marketRiskContext!, w.weight));
          break;
        case 'historical_track_record':
          factors.push(this.buildHistoryFactor(usableHistory!, w.weight));
          break;
        default:
          // Unreachable given WEIGHT_PROFILES is closed above, but guards
          // against a future profile entry with no matching builder.
          throw new Error(`ConvictionEngine has no factor builder for "${w.factorId}"`);
      }
    }

    const rawTotal = factors.reduce((acc, f) => acc + f.contribution, 0);
    const score = Math.round(Math.max(0, Math.min(100, rawTotal)) * 100) / 100;
    const band: ConfidenceBand = bandForScore(score);

    return {
      score,
      band,
      factors,
      computedAt: new Date().toISOString(),
      strategyId: input.strategyId,
      symbol: input.symbol,
      schemaVersion: 1,
    };
  }

  /** Real validation — throws on malformed input rather than silently clamping garbage. */
  private validateInput(input: ConfidenceScoreInput): void {
    if (!input.strategyId || input.strategyId.trim().length === 0) {
      throw new Error('ConvictionEngine: strategyId is required and cannot be empty');
    }
    if (!input.symbol || input.symbol.trim().length === 0) {
      throw new Error('ConvictionEngine: symbol is required and cannot be empty');
    }
    this.assertInRange('signalStrength', input.signalStrength);
    this.assertInRange('regimeAlignment', input.regimeAlignment);
    if (input.marketRiskContext) {
      this.assertInRange('marketRiskContext.volatilityPercentile', input.marketRiskContext.volatilityPercentile);
    }
    if (input.historicalStats) {
      this.assertInRange('historicalStats.winRate', input.historicalStats.winRate);
      if (input.historicalStats.sampleSize < 0) {
        throw new Error('ConvictionEngine: historicalStats.sampleSize cannot be negative');
      }
    }
  }

  private assertInRange(field: string, value: number): void {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 100) {
      throw new Error(`ConvictionEngine: ${field} must be a number in range 0..100, got ${value}`);
    }
  }

  /** Returns historicalStats only if sample size clears the cold-start floor. */
  private usableHistoricalStats(
    stats: ExternalHistoricalPerformanceStats | undefined
  ): ExternalHistoricalPerformanceStats | undefined {
    if (!stats) return undefined;
    if (stats.sampleSize < MIN_SAMPLE_SIZE_FOR_HISTORY) return undefined;
    return stats;
  }

  private selectProfile(
    riskContext: ExternalMarketRiskContext | undefined,
    usableHistory: ExternalHistoricalPerformanceStats | undefined
  ): WeightProfileKey {
    if (riskContext && usableHistory) return 'base_risk_history';
    if (riskContext) return 'base_risk';
    if (usableHistory) return 'base_history';
    return 'base';
  }

  private buildSignalFactor(rawScore: number, weight: number): ConfidenceFactorScore {
    return {
      factorId: 'signal_strength',
      rawScore,
      weight,
      contribution: Math.round(rawScore * weight * 100) / 100,
      rationale: `Signal engine reported strength ${rawScore.toFixed(1)}/100`,
    };
  }

  private buildRegimeFactor(rawScore: number, weight: number): ConfidenceFactorScore {
    return {
      factorId: 'regime_alignment',
      rawScore,
      weight,
      contribution: Math.round(rawScore * weight * 100) / 100,
      rationale: `Regime alignment scored ${rawScore.toFixed(1)}/100 against strategy bias`,
    };
  }

  private buildRiskFactor(ctx: ExternalMarketRiskContext, weight: number): ConfidenceFactorScore {
    const baseSafety = riskLevelBaseSafety(ctx.riskLevel);
    const volatilityDrag = ctx.volatilityPercentile * 0.2;
    const rawScore = Math.max(0, Math.min(100, baseSafety - volatilityDrag));
    const placeholderNote = isPlaceholderRiskContext(ctx)
      ? ' (Phase 6 risk engine not yet implemented — placeholder data, advisory only)'
      : '';
    return {
      factorId: 'risk_penalty',
      rawScore: Math.round(rawScore * 100) / 100,
      weight,
      contribution: Math.round(rawScore * weight * 100) / 100,
      rationale: `Market risk level "${ctx.riskLevel}" at ${ctx.volatilityPercentile.toFixed(1)}th volatility percentile${placeholderNote}`,
    };
  }

  private buildHistoryFactor(
    stats: ExternalHistoricalPerformanceStats,
    weight: number
  ): ConfidenceFactorScore {
    const rawScore = stats.winRate;
    const placeholderNote =
      stats.source === 'PHASE_8_PLACEHOLDER'
        ? ' (Phase 8 learning engine stats surface not yet stable — placeholder data)'
        : '';
    return {
      factorId: 'historical_track_record',
      rawScore,
      weight,
      contribution: Math.round(rawScore * weight * 100) / 100,
      rationale: `Historical win rate ${rawScore.toFixed(1)}% over ${stats.sampleSize} trades${placeholderNote}`,
    };
  }
}
