/**
 * SentimentFusionEngine.ts — Phase 18 Advanced Intelligence
 * ─────────────────────────────────────────────────────────────────────────────
 * Fuses real-time news sentiment scores into technical signal confidence.
 *
 * QUANT RATIONALE:
 * Technical signals alone capture price action; but a LONG signal in a stock
 * with strong bullish news momentum deserves more conviction (higher confidence),
 * while a LONG signal during bearish news flow should be discounted or blocked.
 *
 * Fusion algorithm:
 *  1. Collect all news items for the symbol from the last 4 hours.
 *  2. Compute a weighted sentiment score: BULLISH=+1, BEARISH=-1, NEUTRAL=0,
 *     weighted by news confidence (from RSS sentiment analysis).
 *  3. Map weighted score to a confidence adjustment: [-15%, +15%].
 *  4. Optionally VETO a signal if sentiment strongly contradicts direction.
 */

export interface NewsItem {
  symbol: string | null;
  headline: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number; // 0–100
  publishedAt: Date;
}

export interface SentimentFusionResult {
  adjustedConfidence: number;       // original confidence after fusion
  sentimentScore: number;           // -1 to +1 aggregate
  newsCount: number;                // relevant news items found
  veto: boolean;                    // true if sentiment contradicts signal strongly
  vetoreason?: string;
  direction: 'ALIGNED' | 'COUNTER' | 'NEUTRAL';
}

export class SentimentFusionEngine {
  private readonly FUSION_WINDOW_HOURS = 4;
  private readonly MAX_CONFIDENCE_BOOST = 15;   // +15% max boost
  private readonly MAX_CONFIDENCE_DRAG = 15;    // -15% max drag
  private readonly VETO_THRESHOLD = -0.6;       // strong counter-sentiment veto threshold

  /**
   * Fuse news sentiment for a given symbol and signal direction into
   * adjusted confidence. Returns original confidence if no news found.
   */
  fuse(
    symbol: string,
    signalDirection: 'LONG' | 'SHORT',
    originalConfidence: number,
    newsItems: NewsItem[]
  ): SentimentFusionResult {
    const cutoff = new Date(Date.now() - this.FUSION_WINDOW_HOURS * 60 * 60 * 1000);

    // Filter relevant news: symbol match OR market-wide news (null symbol)
    const relevant = newsItems.filter(n => {
      const withinWindow = n.publishedAt >= cutoff;
      const symbolMatch = !n.symbol || n.symbol.toUpperCase() === symbol.toUpperCase();
      return withinWindow && symbolMatch;
    });

    if (relevant.length === 0) {
      return {
        adjustedConfidence: originalConfidence,
        sentimentScore: 0,
        newsCount: 0,
        veto: false,
        direction: 'NEUTRAL',
      };
    }

    // Compute weighted sentiment score
    let weightedSum = 0;
    let totalWeight = 0;
    for (const item of relevant) {
      const weight = item.confidence / 100;
      const value = item.sentiment === 'BULLISH' ? 1
                  : item.sentiment === 'BEARISH' ? -1
                  : 0;
      weightedSum += value * weight;
      totalWeight += weight;
    }

    const sentimentScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Determine alignment vs signal direction
    const bullishSignal = signalDirection === 'LONG';
    const alignedScore = bullishSignal ? sentimentScore : -sentimentScore;

    // Map alignment score to confidence delta
    const confidenceDelta = alignedScore >= 0
      ? alignedScore * this.MAX_CONFIDENCE_BOOST
      : alignedScore * this.MAX_CONFIDENCE_DRAG;

    const adjustedConfidence = Math.max(0, Math.min(100, originalConfidence + confidenceDelta));

    // Veto logic: if alignment score strongly counter-trend, suppress signal
    const veto = alignedScore < this.VETO_THRESHOLD;
    const vetoreason = veto
      ? `News sentiment strongly ${bullishSignal ? 'BEARISH' : 'BULLISH'} (score: ${sentimentScore.toFixed(2)}) contradicts ${signalDirection} signal. Signal vetoed.`
      : undefined;

    const direction: 'ALIGNED' | 'COUNTER' | 'NEUTRAL' =
      alignedScore > 0.2 ? 'ALIGNED' : alignedScore < -0.2 ? 'COUNTER' : 'NEUTRAL';

    return {
      adjustedConfidence: Math.round(adjustedConfidence * 10) / 10,
      sentimentScore: Math.round(sentimentScore * 1000) / 1000,
      newsCount: relevant.length,
      veto,
      vetoreason,
      direction,
    };
  }
}
