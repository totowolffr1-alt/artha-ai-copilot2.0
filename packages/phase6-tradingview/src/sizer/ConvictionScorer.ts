/**
 * packages/phase6-tradingview/src/sizer/ConvictionScorer.ts
 * Artha AI — Phase 6 Risk Engine — Stage 1
 *
 * Maps signal strength, regime confidence, and setup quality
 * into a single conviction score ∈ [0, 1].
 */

export interface ConvictionInputs {
  strength: number;             // [0, 1] — raw signal evaluator score
  kelly_fraction: number;       // [0, 1] — Kelly fraction from Phase 5
  regime_confidence: number;    // [0, 1] — regime classifier confidence
  spread_pct: number;           // bid-ask spread as % of LTP — from L1 cache
}

export interface ConvictionResult {
  conviction: number;           // [0, 1]
  strength_component: number;
  regime_component: number;
  kelly_component: number;
  liquidity_penalty: number;
  detail: string;
}

export class ConvictionScorer {
  /**
   * Conviction formula:
   *   base = (strength × 0.40) + (regime_confidence × 0.35) + (kelly_fraction × 0.25)
   *   liquidity_penalty applied if spread > 0.15%
   */
  score(inputs: ConvictionInputs): ConvictionResult {
    const { strength, kelly_fraction, regime_confidence, spread_pct } = inputs;

    const strength_component = Math.min(1, strength) * 0.40;
    const regime_component   = Math.min(1, regime_confidence) * 0.35;
    const kelly_component    = Math.min(1, kelly_fraction) * 0.25;

    const base = strength_component + regime_component + kelly_component;

    // Liquidity penalty: reduce conviction if spread is wide
    const liquidity_penalty =
      spread_pct > 0.50 ? 0.20 :
      spread_pct > 0.25 ? 0.10 :
      spread_pct > 0.15 ? 0.05 : 0;

    const conviction = Math.max(0, Math.min(1, base - liquidity_penalty));

    const detail = `strength=${strength.toFixed(3)} kelly=${kelly_fraction.toFixed(3)} regime_conf=${regime_confidence.toFixed(3)} spread=${spread_pct.toFixed(3)}% conviction=${conviction.toFixed(3)}`;

    return { conviction, strength_component, regime_component, kelly_component, liquidity_penalty, detail };
  }
}
