/**
 * packages/phase5-strategy/src/strategies/StrategyRouter.ts
 * Artha AI — Dynamic Strategy Router & Meta-Scoring Engine
 *
 * Routes incoming market data across all active strategies in the strategy arsenal,
 * ranks sub-strategy signals by regime fit and confidence, applies PositionSizer,
 * and emits an enriched, sized SignalEvent.
 */

import { IStrategy, StrategySignal } from './IStrategy';
import { TrendFollowerStrategy } from './TrendFollowerStrategy';
import { MeanReversionStrategy } from './MeanReversionStrategy';
import { VolatilitySqueezeStrategy } from './VolatilitySqueezeStrategy';
import { IndicatorSnapshot } from '../indicators/IndicatorPipeline';
import { RegimeClassification } from '../signals/RegimeEngine';
import { SignalEvent } from '../signals/SignalEvent';
import { PositionSizer } from '../signals/PositionSizer';
import { MarketSessionGuard } from '../signals/MarketSessionGuard';
import { SentimentFusionEngine, NewsItem } from '../intelligence/SentimentFusionEngine';

export class StrategyRouter {
  private readonly strategies: IStrategy[] = [];
  private readonly positionSizer = new PositionSizer();
  private readonly sentimentFusion = new SentimentFusionEngine();
  private portfolioEquity: number = 1_000_000;

  constructor() {
    // Register standard Strategy Arsenal
    this.registerStrategy(new TrendFollowerStrategy());
    this.registerStrategy(new MeanReversionStrategy());
    this.registerStrategy(new VolatilitySqueezeStrategy());
  }

  registerStrategy(strategy: IStrategy): void {
    this.strategies.push(strategy);
  }

  setPortfolioEquity(equity: number): void {
    this.portfolioEquity = Math.max(0, equity);
  }

  /**
   * Evaluates all registered strategies for a bar and returns the best SignalEvent, or null.
   * @param newsItems Optional recent news items for sentiment fusion
   */
  route(
    symbol: string,
    currentPrice: number,
    snapshot: IndicatorSnapshot,
    regime: RegimeClassification,
    volume: number,
    barTs: Date = new Date(),
    newsItems: NewsItem[] = []
  ): SignalEvent | null {
    // 1. Session Gate check
    const session = MarketSessionGuard.getSessionInfo(barTs.getTime());
    if (!session.canTrade) return null;

    // 2. Warmup check
    if (regime.label === 'WARMUP') return null;

    // 3. Evaluate each strategy
    const candidateSignals: StrategySignal[] = [];
    for (const strategy of this.strategies) {
      const sig = strategy.evaluate(symbol, currentPrice, snapshot, regime, volume);
      if (sig) candidateSignals.push(sig);
    }

    if (candidateSignals.length === 0) return null;

    // 4. Sort candidates by rawConfidence (highest first)
    candidateSignals.sort((a, b) => b.rawConfidence - a.rawConfidence);
    const bestSignal = candidateSignals[0];

    // 5. Apply Sentiment Fusion — adjust confidence based on news sentiment alignment
    const fusion = this.sentimentFusion.fuse(
      symbol,
      bestSignal.direction,
      bestSignal.rawConfidence,
      newsItems
    );

    // If sentiment strongly vetoes the signal, suppress it
    if (fusion.veto) {
      console.warn(`[StrategyRouter] Signal VETOED for ${symbol}: ${fusion.vetoreason}`);
      return null;
    }

    // 6. Calculate dynamic position size via PositionSizer
    const sizing = this.positionSizer.calculate({
      portfolioEquity: this.portfolioEquity,
      entryPrice: bestSignal.entryPrice,
      stopLossPrice: bestSignal.stopLossPrice,
      atr14: snapshot.atr14,
    });

    const signalEvent: SignalEvent = {
      signal_id: `sig-${Math.random().toString(36).substring(2, 11)}`,
      symbol,
      exchange: 'NSE',
      direction: bestSignal.direction,
      strength: bestSignal.strength,
      confidence: fusion.adjustedConfidence,  // sentiment-fused confidence
      entry_price: bestSignal.entryPrice,
      stop_loss: bestSignal.stopLossPrice,
      take_profit: bestSignal.takeProfitPrice,
      rsi: snapshot.rsi14,
      macd_hist: snapshot.macd.histogram,
      atr: snapshot.atr14,
      ema20: snapshot.ema20,
      ema50: snapshot.ema50,
      regime: regime.label,
      regime_confidence: regime.confidence,
      recommended_qty: sizing.recommendedQty,
      risk_amount: sizing.riskAmount,
      kelly_fraction: sizing.kellyFraction,
      session_status: session.status,
      sentiment_score: fusion.sentimentScore,
      sentiment_direction: fusion.direction,
      sentiment_news_count: fusion.newsCount,
      emitted_at: new Date(),
      bar_ts: barTs,
    };

    return signalEvent;
  }

  getRegisteredStrategies(): string[] {
    return this.strategies.map(s => s.name);
  }
}
