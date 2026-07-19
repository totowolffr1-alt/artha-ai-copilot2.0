import {
  ConfidenceScore,
  ConfidenceFactorScore,
  Explanation,
  ExplanationTone,
  FactorNarrative,
  IExplanationGenerator,
  BAND_LABELS,
} from '../contracts';

/**
 * Phase 10C — ExplanationGenerator
 * ==================================
 * Converts a Phase 10B ConvictionEngine output (`ConfidenceScore`) into a
 * ranked, human-readable `Explanation`. Imports only from `../contracts` —
 * does NOT import ConvictionEngine itself, so it works with any
 * `IConfidenceScoreCalculator` implementation, not just Phase 10B's.
 *
 * PLACEHOLDER DETECTION — KNOWN LIMITATION (see Explanation.ts contract doc)
 * ----------------------------------------------------------------------------
 * Detects placeholder-backed factors via substring match against the marker
 * phrases ConvictionEngine (Phase 10B) currently writes into `rationale`
 * text. This is intentional string-convention coupling, not type coupling —
 * kept local to this file (rather than importing from ConvictionEngine.ts)
 * so Phase 10B remains untouched and frozen. If ConvictionEngine's rationale
 * wording changes, update `PLACEHOLDER_MARKERS` below.
 */

const PLACEHOLDER_MARKERS: ReadonlyArray<string> = [
  'Phase 6 risk engine not yet implemented',
  'Phase 8 learning engine stats surface not yet stable',
];

function isPlaceholderRationale(rationale: string): boolean {
  return PLACEHOLDER_MARKERS.some((marker) => rationale.includes(marker));
}

export class ExplanationGenerator implements IExplanationGenerator {
  generate(score: ConfidenceScore, tone: ExplanationTone = 'detailed'): Explanation {
    if (!score.factors || score.factors.length === 0) {
      throw new Error('ExplanationGenerator: ConfidenceScore.factors must contain at least one factor');
    }

    const ranked = this.rankFactors(score.factors);
    const factorNarratives = ranked.map((f, idx) =>
      this.buildNarrative(f, idx + 1, tone)
    );
    const placeholderDisclosures = score.factors
      .filter((f) => isPlaceholderRationale(f.rationale))
      .map((f) => f.rationale);

    return {
      summary: this.buildSummary(score),
      factorNarratives,
      placeholderDisclosures,
      strategyId: score.strategyId,
      symbol: score.symbol,
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
    };
  }

  /** Descending by absolute contribution — largest driver first, regardless of sign. */
  private rankFactors(factors: ReadonlyArray<ConfidenceFactorScore>): ConfidenceFactorScore[] {
    return [...factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  }

  private buildSummary(score: ConfidenceScore): string {
    const label = BAND_LABELS[score.band];
    return `${score.score}/100 — ${label} for ${score.symbol}`;
  }

  private buildNarrative(
    factor: ConfidenceFactorScore,
    rank: number,
    tone: ExplanationTone
  ): FactorNarrative {
    const rankLabel = this.rankLabel(rank);
    const text =
      tone === 'concise'
        ? `${rankLabel}: ${factor.factorId.replace(/_/g, ' ')} (${factor.rawScore.toFixed(0)}/100)`
        : `${rankLabel}: ${factor.rationale} — contributed ${factor.contribution.toFixed(1)} points at weight ${factor.weight}`;
    return { factorId: factor.factorId, rank, text };
  }

  private rankLabel(rank: number): string {
    if (rank === 1) return 'Primary driver';
    if (rank === 2) return 'Secondary factor';
    return `Contributing factor #${rank}`;
  }
}
