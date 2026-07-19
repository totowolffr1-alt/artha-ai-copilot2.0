/**
 * packages/phase10-copilot-intelligence/src/engine/OpportunityScorer.ts
 * Artha AI — Phase 10 Opportunity Scorer
 *
 * Fuses all Phase 5–9 engine outputs into a single Composite Copilot Score (0–100).
 *
 * Weights:
 *   Signal confidence (Phase 5/6)  : 35%
 *   Market regime fit (Phase 6)    : 25%
 *   Learned win rate (Phase 8)     : 20%
 *   Portfolio heat headroom        : 10%
 *   Safety gate (Phase 9)          : 10%
 */

import {
  RawOpportunity,
  ScoredOpportunity,
  MarketRegime,
  ConfidenceBand,
} from '../types';

/** Regime multipliers — how much the regime boosts/penalises the raw signal confidence */
const REGIME_MULTIPLIER: Record<MarketRegime, number> = {
  STRONG_BULL:     1.0,
  BULL:            0.90,
  NEUTRAL:         0.75,
  CAUTION:         0.55,
  HIGH_VOLATILITY: 0.40,
  CRASH:           0.10,
};

export class OpportunityScorer {
  /**
   * Score a raw opportunity and enrich it with copilot metadata.
   * Returns null if the opportunity is un-tradeable (kill switch active).
   */
  score(opp: RawOpportunity): ScoredOpportunity {
    // ── Component scores (each 0–100) ─────────────────────────

    // 1. Signal confidence (35%)
    const confidenceScore = opp.signal_confidence * 100 * 0.35;

    // 2. Regime fit (25%) — multiply raw regime multiplier by 100
    const regimeScore = (REGIME_MULTIPLIER[opp.regime] ?? 0.5) * 100 * 0.25;

    // 3. Learned win rate from Phase 8 (20%)
    const winRateScore = opp.learned_win_rate * 100 * 0.20;

    // 4. Portfolio heat headroom (10%) — more room = better
    const heatHeadroom = Math.max(0, 1 - opp.portfolio_heat);
    const heatScore = heatHeadroom * 100 * 0.10;

    // 5. Safety gate (10%) — 0 if kill switch active, full otherwise
    const safetyScore = opp.kill_switch_active ? 0 : 10;

    const rawScore = confidenceScore + regimeScore + winRateScore + heatScore + safetyScore;
    const copilot_score = Math.min(100, Math.max(0, Math.round(rawScore)));

    // ── Confidence band ───────────────────────────────────────
    const confidence_band: ConfidenceBand =
      copilot_score >= 72 ? 'HIGH' :
      copilot_score >= 55 ? 'MEDIUM' :
      'LOW';

    // ── Plain-English brief ───────────────────────────────────
    const brief = this._composeBrief(opp, copilot_score, confidence_band);
    const detail_lines = this._composeDetailLines(opp, copilot_score);

    return {
      ...opp,
      copilot_score,
      confidence_band,
      brief,
      detail_lines,
      should_notify: !opp.kill_switch_active,
    };
  }

  private _composeBrief(
    opp: RawOpportunity,
    score: number,
    band: ConfidenceBand
  ): string {
    const dir  = opp.direction === 'LONG' ? '📈 LONG (Bullish)' : '📉 SHORT (Bearish)';
    const icon = band === 'HIGH' ? '🚀' : band === 'MEDIUM' ? '⚡' : '💡';
    const topReason = this._topReason(opp);

    return `${icon} ${opp.symbol} ${dir} — ${topReason}. Confidence: ${score}% [${band}].`;
  }

  private _composeDetailLines(opp: RawOpportunity, score: number): string[] {
    const riskPct = ((Math.abs(opp.ltp - opp.stop_price) / opp.ltp) * 100).toFixed(2);
    const targetPct = ((Math.abs(opp.target_price - opp.ltp) / opp.ltp) * 100).toFixed(2);
    const rrRatio = (
      Math.abs(opp.target_price - opp.ltp) /
      Math.abs(opp.ltp - opp.stop_price)
    ).toFixed(1);

    return [
      `Symbol    : ${opp.symbol}`,
      `Direction : ${opp.direction === 'LONG' ? 'LONG  📈 Bullish' : 'SHORT 📉 Bearish'}`,
      `Score     : ${score}/100  [${score >= 72 ? 'HIGH' : score >= 55 ? 'MEDIUM' : 'LOW'}]`,
      `Regime    : ${opp.regime}`,
      ``,
      `Why       : ${this._topReason(opp)}`,
      `           Phase 8 win rate on this pattern: ${(opp.learned_win_rate * 100).toFixed(0)}%`,
      ``,
      `Risk      : Stop at ₹${opp.stop_price.toFixed(2)} (-${riskPct}%)`,
      `Target    : ₹${opp.target_price.toFixed(2)} (+${targetPct}%)`,
      `R:R Ratio : ${rrRatio}:1`,
      `Max Qty   : ${opp.kelly_qty} units (Phase 6 Kelly sized)`,
    ];
  }

  /** Derive the single best plain-English reason from indicator values */
  private _topReason(opp: RawOpportunity): string {
    const reasons: Array<{ text: string; priority: number }> = [];

    if (opp.direction === 'LONG') {
      if (opp.rsi < 35)  reasons.push({ text: `RSI at ${opp.rsi.toFixed(1)} (oversold recovery)`, priority: 10 });
      if (opp.macd > opp.macd_signal && opp.macd > 0)
        reasons.push({ text: 'MACD bullish crossover above zero', priority: 9 });
      if (opp.ltp <= opp.bb_lower * 1.01)
        reasons.push({ text: 'Price bouncing off Bollinger lower band', priority: 8 });
      if (opp.rsi > 50 && opp.rsi < 65)
        reasons.push({ text: `RSI at ${opp.rsi.toFixed(1)} showing positive momentum`, priority: 6 });
    } else {
      if (opp.rsi > 68)  reasons.push({ text: `RSI at ${opp.rsi.toFixed(1)} (overbought reversal)`, priority: 10 });
      if (opp.macd < opp.macd_signal && opp.macd < 0)
        reasons.push({ text: 'MACD bearish crossover below zero', priority: 9 });
      if (opp.ltp >= opp.bb_upper * 0.99)
        reasons.push({ text: 'Price rejecting Bollinger upper band', priority: 8 });
    }

    // Regime bonus
    if (opp.regime === 'STRONG_BULL' && opp.direction === 'LONG')
      reasons.push({ text: 'Strong bull regime confirms long bias', priority: 7 });
    if (opp.regime === 'HIGH_VOLATILITY')
      reasons.push({ text: `High volatility regime — elevated ATR (${opp.atr.toFixed(2)})`, priority: 5 });

    if (reasons.length === 0)
      return `Technical confluence at ₹${opp.ltp.toFixed(2)}`;

    reasons.sort((a, b) => b.priority - a.priority);
    return reasons[0].text;
  }
}
