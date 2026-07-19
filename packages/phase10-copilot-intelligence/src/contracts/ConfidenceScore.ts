/**
 * Phase 10A — Confidence Score Contract
 * =======================================
 * Foundation contract for the Copilot Intelligence Layer (Phase 10).
 *
 * This module is intentionally dependency-free at the type level. It defines
 * the shape of a trade confidence score and the factors that compose it, so
 * that Phase 10B (ConvictionEngine), Phase 10C (ExplanationGenerator), and
 * Phase 10D+ (TradeApprovalEngine integration) can all be built against a
 * single stable contract.
 *
 * FROZEN-PHASE POLICY
 * --------------------
 * Phase 2 (Market Data) and Phase 5 (Strategy/Signal Engine) are treated as
 * frozen. This file does not import from either — it only references their
 * conceptual identifiers (e.g. a strategy id, a symbol string) as primitive
 * types, so no coupling exists until an explicit adapter is written.
 *
 * EXTERNAL DEPENDENCY DISCLOSURE
 * -------------------------------
 * Phase 6 (Risk Engine) and Phase 3 (Database Layer) do not have
 * implementation code in this repo yet — design docs only. Where this
 * contract needs to reference risk context or historical stats, it uses a
 * clearly-marked placeholder type (see `ExternalMarketRiskContext` below)
 * rather than pretending a real integration exists. Swap the placeholder
 * for the real Phase 6 type once that phase ships; consumers of
 * `ConfidenceScoreInput` will not need to change their own shape as a
 * result, only the type of the `marketRiskContext` field.
 */

/** Discrete confidence band derived from the composite numeric score. */
export type ConfidenceBand = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';

/**
 * Weight assigned to a single scoring factor. Weights across all active
 * factors in a given calculation should sum to 1.0 — validated at runtime
 * by `assertValidWeights` (Phase 10B calculator will call this), not
 * enforced by the type system.
 */
export interface ConfidenceFactorWeight {
  readonly factorId: string;
  readonly weight: number; // 0..1
}

/**
 * The scored contribution of a single factor (e.g. "signal_strength",
 * "regime_alignment", "risk_penalty") toward the composite score. The
 * `rationale` field is short, human-readable, and intended as direct input
 * to Phase 10C's ExplanationGenerator — it is not free-form logging text.
 */
export interface ConfidenceFactorScore {
  readonly factorId: string;
  readonly rawScore: number; // 0..100, factor's own scale before weighting
  readonly weight: number; // 0..1
  readonly contribution: number; // rawScore * weight, pre-computed for convenience
  readonly rationale: string; // e.g. "Regime alignment strong: trending_up matches strategy bias"
}

/**
 * The composite confidence score for a single (strategy, symbol) evaluation
 * at a point in time. This is the primary output contract of Phase 10B.
 */
export interface ConfidenceScore {
  readonly score: number; // 0..100 composite, weighted sum of factor contributions
  readonly band: ConfidenceBand;
  readonly factors: ReadonlyArray<ConfidenceFactorScore>;
  readonly computedAt: string; // ISO 8601 timestamp
  readonly strategyId: string; // opaque id, matches Phase 5 StrategyDefinition.id — no import coupling
  readonly symbol: string; // NSE/BSE/NFO/MCX instrument symbol
  readonly schemaVersion: 1; // bump on breaking shape change; consumers should check this
}

/**
 * EXTERNAL DEPENDENCY — Phase 6 (Risk Engine).
 * Design-doc only in this repo; no implementation exists. This is a minimal
 * structural placeholder so Phase 10 code compiles and can be exercised in
 * tests today. It is NOT a real risk integration — `source` is set to a
 * literal marker so any consumer can detect placeholder data at runtime and
 * avoid trading decisions on it.
 */
export interface ExternalMarketRiskContext {
  readonly riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  readonly volatilityPercentile: number; // 0..100
  readonly source: 'PHASE_6_PLACEHOLDER';
}

/**
 * EXTERNAL DEPENDENCY — Phase 8 (Learning Engine) historical stats.
 * Phase 8 is in-progress in this repo (per package.json), not yet exposing
 * a stable stats query surface consumable here. Optional field — a
 * calculator MUST be able to produce a valid ConfidenceScore without it
 * (e.g. cold-start, no trading history yet for this strategy/symbol pair).
 */
export interface ExternalHistoricalPerformanceStats {
  readonly winRate: number; // 0..100
  readonly sampleSize: number;
  readonly source: 'PHASE_8_PLACEHOLDER';
}

/**
 * Input required to compute a ConfidenceScore. `marketRiskContext` and
 * `historicalStats` are optional and placeholder-typed per the disclosures
 * above — a real calculator must degrade gracefully (e.g. skip the
 * corresponding factor, or use a conservative default) when they are
 * absent, rather than throwing.
 */
export interface ConfidenceScoreInput {
  readonly strategyId: string;
  readonly symbol: string;
  readonly signalStrength: number; // 0..100, from Phase 5 signal engine output
  readonly regimeAlignment: number; // 0..100, from Phase 5 regime engine output
  readonly marketRiskContext?: ExternalMarketRiskContext;
  readonly historicalStats?: ExternalHistoricalPerformanceStats;
}

/** Calculator contract — implemented by Phase 10B's ConvictionEngine. */
export interface IConfidenceScoreCalculator {
  calculate(input: ConfidenceScoreInput): ConfidenceScore;
}

/**
 * Ordered high-to-low; first matching threshold wins. Kept as a named,
 * exported constant (not buried in a function) so Phase 10C can render
 * band boundaries in explanations without duplicating magic numbers.
 */
export const CONFIDENCE_BAND_THRESHOLDS: ReadonlyArray<{ min: number; band: ConfidenceBand }> = [
  { min: 80, band: 'very_high' },
  { min: 60, band: 'high' },
  { min: 40, band: 'moderate' },
  { min: 20, band: 'low' },
  { min: 0, band: 'very_low' },
];

/** Maps a composite 0..100 score to its discrete band. Clamps out-of-range input. */
export function bandForScore(score: number): ConfidenceBand {
  const clamped = Math.max(0, Math.min(100, score));
  for (const threshold of CONFIDENCE_BAND_THRESHOLDS) {
    if (clamped >= threshold.min) return threshold.band;
  }
  return 'very_low';
}

/**
 * Validates that a set of factor weights sums to 1.0 within floating-point
 * tolerance. Throws with a descriptive message on failure — callers (Phase
 * 10B) should call this before computing a score, not after.
 */
export function assertValidWeights(weights: ReadonlyArray<ConfidenceFactorWeight>): void {
  const sum = weights.reduce((acc, w) => acc + w.weight, 0);
  const tolerance = 1e-6;
  if (Math.abs(sum - 1) > tolerance) {
    throw new Error(
      `ConfidenceScore weights must sum to 1.0, got ${sum} across factors: ` +
        weights.map((w) => `${w.factorId}=${w.weight}`).join(', ')
    );
  }
}

/**
 * True if a given risk context is placeholder (Phase 6 not yet real).
 * Consumers making live trading decisions should check this and treat a
 * placeholder-backed score as advisory-only, never as risk-cleared.
 */
export function isPlaceholderRiskContext(
  ctx: ExternalMarketRiskContext | undefined
): ctx is ExternalMarketRiskContext {
  return ctx?.source === 'PHASE_6_PLACEHOLDER';
}
