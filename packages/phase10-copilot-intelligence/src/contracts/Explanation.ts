import { ConfidenceScore, ConfidenceBand } from './ConfidenceScore';

/**
 * Phase 10C — Explanation Contract
 * ==================================
 * Additive contract. Does not modify ConfidenceScore.ts (Phase 10A, frozen
 * on approval). Defines the shape of a human-readable explanation derived
 * from a ConfidenceScore, for display in copilot UI / chat.
 */

export type ExplanationTone = 'concise' | 'detailed';

/**
 * A single ranked, human-readable narrative line for one contributing
 * factor. Ordered by the generator from highest to lowest |contribution|.
 */
export interface FactorNarrative {
  readonly factorId: string;
  readonly rank: number; // 1 = largest absolute contribution
  readonly text: string; // e.g. "Primary driver: signal strength scored 80/100"
}

export interface Explanation {
  readonly summary: string; // one-line: score + band, e.g. "72/100 — High confidence"
  readonly factorNarratives: ReadonlyArray<FactorNarrative>;
  /**
   * Any factor whose rationale indicates it was computed from a Phase 6/8
   * placeholder rather than a real implementation. Non-empty means this
   * explanation MUST be presented to the user as advisory-only, not as a
   * risk-cleared or fully-informed confidence figure.
   *
   * KNOWN LIMITATION: populated via substring match against marker phrases
   * ConvictionEngine (Phase 10B) writes into `rationale` text (e.g.
   * "PHASE_6_PLACEHOLDER" related wording). This is coupling by string
   * convention, not by type — if ConvictionEngine's rationale wording
   * changes, this detection can silently stop matching. Tracked as a
   * candidate for a schemaVersion 2 change adding a machine-readable
   * `isPlaceholder: boolean` to `ConfidenceFactorScore` directly.
   */
  readonly placeholderDisclosures: ReadonlyArray<string>;
  readonly strategyId: string;
  readonly symbol: string;
  readonly generatedAt: string; // ISO 8601
  readonly schemaVersion: 1;
}

export interface IExplanationGenerator {
  generate(score: ConfidenceScore, tone?: ExplanationTone): Explanation;
}

/** Human-readable phrasing per band, used to build the one-line summary. */
export const BAND_LABELS: Record<ConfidenceBand, string> = {
  very_low: 'Very low confidence',
  low: 'Low confidence',
  moderate: 'Moderate confidence',
  high: 'High confidence',
  very_high: 'Very high confidence',
};
