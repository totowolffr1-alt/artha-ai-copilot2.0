/**
 * SentimentFusion.test.ts — Phase 18 Unit Tests
 * Tests the SentimentFusionEngine confidence adjustment and veto logic.
 */

import { SentimentFusionEngine, NewsItem } from '../intelligence/SentimentFusionEngine';

const engine = new SentimentFusionEngine();

function makeNews(
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  confidence: number,
  symbol: string | null = null,
  ageMinutes = 30
): NewsItem {
  return {
    symbol,
    headline: `Test headline (${sentiment})`,
    sentiment,
    confidence,
    publishedAt: new Date(Date.now() - ageMinutes * 60 * 1000),
  };
}

describe('SentimentFusionEngine', () => {
  test('returns unadjusted confidence when no news available', () => {
    const result = engine.fuse('RELIANCE', 'LONG', 65, []);
    expect(result.adjustedConfidence).toBe(65);
    expect(result.sentimentScore).toBe(0);
    expect(result.newsCount).toBe(0);
    expect(result.veto).toBe(false);
    expect(result.direction).toBe('NEUTRAL');
  });

  test('boosts confidence when bullish news aligns with LONG signal', () => {
    const news: NewsItem[] = [
      makeNews('BULLISH', 90, 'RELIANCE'),
      makeNews('BULLISH', 80, null),
    ];
    const result = engine.fuse('RELIANCE', 'LONG', 65, news);
    expect(result.adjustedConfidence).toBeGreaterThan(65);
    expect(result.direction).toBe('ALIGNED');
    expect(result.veto).toBe(false);
    expect(result.newsCount).toBe(2);
  });

  test('drags confidence down when bearish news contradicts LONG signal (no veto)', () => {
    // 60% BEARISH + NEUTRAL → fused score ≈ -0.43 → COUNTER but not veto
    const news: NewsItem[] = [
      makeNews('BEARISH', 60, 'TCS'),
      makeNews('NEUTRAL', 80, null),
    ];
    const result = engine.fuse('TCS', 'LONG', 65, news);
    expect(result.adjustedConfidence).toBeLessThan(65);
    expect(result.direction).toBe('COUNTER');
    expect(result.veto).toBe(false);
  });

  test('vetoes LONG signal with strong bearish news (score < -0.6)', () => {
    const news: NewsItem[] = [
      makeNews('BEARISH', 100, 'INFY'),
      makeNews('BEARISH', 100, 'INFY'),
      makeNews('BEARISH', 95, null),
    ];
    const result = engine.fuse('INFY', 'LONG', 70, news);
    expect(result.veto).toBe(true);
    expect(result.vetoreason).toContain('vetoed');
  });

  test('ignores stale news older than 4 hours', () => {
    const staleNews: NewsItem[] = [
      makeNews('BULLISH', 100, 'WIPRO', 300), // 5 hours old
    ];
    const result = engine.fuse('WIPRO', 'LONG', 60, staleNews);
    expect(result.adjustedConfidence).toBe(60);
    expect(result.newsCount).toBe(0);
  });

  test('aligns bullish news with SHORT signal correctly drags confidence', () => {
    const news: NewsItem[] = [
      makeNews('BULLISH', 90, 'HDFCBANK'),
    ];
    // BULLISH news + SHORT signal = counter
    const result = engine.fuse('HDFCBANK', 'SHORT', 60, news);
    expect(result.adjustedConfidence).toBeLessThan(60);
    expect(result.direction).toBe('COUNTER');
  });

  test('neutral news produces minimal confidence adjustment', () => {
    const news: NewsItem[] = [
      makeNews('NEUTRAL', 80, 'ZOMATO'),
    ];
    const result = engine.fuse('ZOMATO', 'LONG', 65, news);
    expect(result.adjustedConfidence).toBe(65);
    expect(result.direction).toBe('NEUTRAL');
  });
});
