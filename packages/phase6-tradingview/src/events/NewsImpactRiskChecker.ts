/**
 * packages/phase6-tradingview/src/events/NewsImpactRiskChecker.ts
 * Artha AI — Phase 6 Risk Engine — Stage 5
 *
 * Evaluates news impact on a symbol using the INewsCache.
 * Defaults to NullNewsImpactRiskChecker if no external feed is configured.
 *
 * Impact tiers:
 *   LOW     → no size change
 *   MEDIUM  → size × news_impact_medium_multiplier (default 0.75)
 *   HIGH    → size × news_impact_high_multiplier   (default 0.50)
 *   EXTREME → REJECT
 */

import { INewsCache } from '../contracts/INewsCache';
import { NewsImpactAssessment, SwingRiskConfig } from '../types';

export interface NewsRiskResult {
  passed: boolean;
  size_multiplier: number;
  assessment: NewsImpactAssessment | null;
  reject_reason?: string;
  detail: string;
}

export class NewsImpactRiskChecker {
  constructor(private readonly newsCache: INewsCache) {}

  check(symbol_id: string, cfg: SwingRiskConfig): NewsRiskResult {
    const assessment = this.newsCache.getImpact(symbol_id);

    if (!assessment) {
      return {
        passed: true,
        size_multiplier: 1.0,
        assessment: null,
        detail: 'No news data — no size adjustment',
      };
    }

    switch (assessment.impact_tier) {
      case 'EXTREME':
        return {
          passed: false,
          size_multiplier: 0,
          assessment,
          reject_reason: `Extreme news impact: ${assessment.dominant_category} (sentiment=${assessment.avg_sentiment.toFixed(2)})`,
          detail: assessment.detail,
        };
      case 'HIGH':
        return {
          passed: true,
          size_multiplier: cfg.news_impact_high_multiplier,
          assessment,
          detail: `HIGH news impact → size × ${cfg.news_impact_high_multiplier}: ${assessment.detail}`,
        };
      case 'MEDIUM':
        return {
          passed: true,
          size_multiplier: cfg.news_impact_medium_multiplier,
          assessment,
          detail: `MEDIUM news impact → size × ${cfg.news_impact_medium_multiplier}: ${assessment.detail}`,
        };
      default:
        return {
          passed: true,
          size_multiplier: 1.0,
          assessment,
          detail: `LOW news impact — no size adjustment`,
        };
    }
  }
}

/**
 * Null implementation — used when no news feed is configured.
 * Always passes with no size adjustment.
 */
export class NullNewsCache implements INewsCache {
  getImpact(_symbol_id: string): NewsImpactAssessment | null { return null; }
  async refresh(): Promise<void> { /* no-op */ }
}
