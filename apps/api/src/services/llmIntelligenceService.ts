/**
 * llmIntelligenceService.ts — Phase 18 Advanced Intelligence
 * ─────────────────────────────────────────────────────────────────────────────
 * LLM-powered regime commentary and per-signal trade rationale generation.
 *
 * Uses Groq (llama-3.3-70b-versatile) with structured prompts to produce:
 *  1. Regime Commentary  — daily narrative of current market regime
 *  2. Trade Rationale    — per-signal entry thesis, risk, and catalyst analysis
 */

import Groq from 'groq-sdk';

// ── Groq singleton ─────────────────────────────────────────────────────────────
let groq: Groq | null = null;
function getGroq(): Groq {
  if (!groq) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groq;
}

// ── Types ──────────────────────────────────────────────────────────────────────
export interface SignalContext {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  strategy: string;
  confidence: number;
  regime: string;
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  riskRewardRatio: number;
  sentimentScore?: number;
  sentimentDirection?: string;
  newsHeadlines?: string[];
}

export interface RegimeContext {
  regime: string;
  adxStrength?: number;
  rsiLevel?: number;
  bbWidthPct?: number;
  macdSignal?: string;
  winRate?: number;
  sharpeRatio?: number;
  openPositions?: number;
  topSymbols?: string[];
}

export interface TradeRationale {
  entryThesis: string;
  keyRisks: string;
  catalysts: string;
  quantMetrics: string;
  managementGuidance: string;
  overallScore: string;
  generatedAt: string;
  source: 'groq' | 'fallback';
}

export interface RegimeCommentary {
  regimeName: string;
  narrative: string;
  tacticalGuidance: string;
  watchOutFor: string;
  generatedAt: string;
  source: 'groq' | 'fallback';
}

// ── Rate Limiter — max 1 call per symbol per 5 minutes ────────────────────────
const rationaleCache = new Map<string, { commentary: TradeRationale; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const regimeCache: { commentary: RegimeCommentary | null; ts: number } = { commentary: null, ts: 0 };
const REGIME_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min cache for regime commentary

// ── TRADE RATIONALE GENERATOR ─────────────────────────────────────────────────

/**
 * Generate LLM rationale for a specific trade signal.
 * Cached per symbol for 5 minutes to avoid Groq rate limits.
 */
export async function generateTradeRationale(ctx: SignalContext): Promise<TradeRationale> {
  const now = Date.now();
  const cacheKey = `${ctx.symbol}:${ctx.direction}`;
  const cached = rationaleCache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.commentary;

  const newsCtx = ctx.newsHeadlines && ctx.newsHeadlines.length > 0
    ? `\nRecent news headlines:\n${ctx.newsHeadlines.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}`
    : '';

  const prompt = `You are an elite Indian stock market quant analyst. Provide a structured trade rationale for the following signal.

SIGNAL DETAILS:
- Symbol: ${ctx.symbol} (NSE)
- Direction: ${ctx.direction}
- Strategy: ${ctx.strategy}
- Confidence: ${ctx.confidence}%
- Market Regime: ${ctx.regime}
- Entry Price: ₹${ctx.entryPrice}
- Take Profit: ₹${ctx.takeProfit}
- Stop Loss: ₹${ctx.stopLoss}
- Risk/Reward: ${ctx.riskRewardRatio.toFixed(2)}:1
- News Sentiment: ${ctx.sentimentDirection || 'NEUTRAL'} (score: ${(ctx.sentimentScore ?? 0).toFixed(2)})${newsCtx}

Respond in this EXACT JSON format (no markdown, pure JSON):
{
  "entryThesis": "2-3 sentences explaining why this is a high-quality entry",
  "keyRisks": "2-3 sentences on the main risks and what would invalidate this trade",
  "catalysts": "Key technical or fundamental catalysts supporting this setup",
  "quantMetrics": "Commentary on the R:R ratio, position sizing approach, and confidence level",
  "managementGuidance": "How to manage this trade — scaling, trailing stop, time-stop guidance",
  "overallScore": "A/B/C grade with one-line justification"
}`;

  try {
    const completion = await getGroq().chat.completions.create({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);

    const rationale: TradeRationale = {
      entryThesis: parsed.entryThesis || 'Technical setup shows favorable entry conditions.',
      keyRisks: parsed.keyRisks || 'Monitor stop loss levels.',
      catalysts: parsed.catalysts || 'Technical momentum supports the setup.',
      quantMetrics: parsed.quantMetrics || `R:R ${ctx.riskRewardRatio.toFixed(2)}:1 at ${ctx.confidence}% confidence.`,
      managementGuidance: parsed.managementGuidance || 'Trail stop to breakeven on 1% gain.',
      overallScore: parsed.overallScore || 'B - Standard setup',
      generatedAt: new Date().toISOString(),
      source: 'groq',
    };

    rationaleCache.set(cacheKey, { commentary: rationale, ts: now });
    return rationale;

  } catch (err: any) {
    console.error('[LLM Intelligence] Trade rationale generation failed:', err?.message);
    const fallback: TradeRationale = {
      entryThesis: `${ctx.strategy} strategy detected a ${ctx.direction} setup in ${ctx.regime} market regime with ${ctx.confidence}% confidence.`,
      keyRisks: `Stop loss at ₹${ctx.stopLoss} — exit immediately if breached. R:R ${ctx.riskRewardRatio.toFixed(2)}:1.`,
      catalysts: `Technical indicators aligned with ${ctx.regime} regime conditions.`,
      quantMetrics: `Quarter-Kelly position sizing at ${ctx.confidence}% signal confidence. Max risk 1% of portfolio.`,
      managementGuidance: 'Trail stop to breakeven after 1% gain. Close before 15:15 IST for intraday.',
      overallScore: ctx.confidence >= 70 ? 'B+ - High confidence technical setup' : 'C+ - Moderate confidence setup',
      generatedAt: new Date().toISOString(),
      source: 'fallback',
    };
    rationaleCache.set(cacheKey, { commentary: fallback, ts: now });
    return fallback;
  }
}

// ── REGIME COMMENTARY GENERATOR ───────────────────────────────────────────────

/**
 * Generate a narrative market regime commentary using current regime metrics.
 * Cached for 15 minutes to prevent excessive API calls.
 */
export async function generateRegimeCommentary(ctx: RegimeContext): Promise<RegimeCommentary> {
  const now = Date.now();
  if (regimeCache.commentary && now - regimeCache.ts < REGIME_CACHE_TTL_MS) {
    return regimeCache.commentary;
  }

  const regimeDescriptions: Record<string, string> = {
    TRENDING_UP: 'strong bullish trend with sustained momentum',
    TRENDING_DOWN: 'strong bearish trend / corrective phase',
    SIDEWAYS: 'range-bound consolidation / mean-reversion opportunity',
    LOW_VOLATILITY: 'volatility compression / potential breakout imminent',
    HIGH_VOLATILITY: 'elevated risk environment / reduced position sizing advised',
  };

  const description = regimeDescriptions[ctx.regime] || 'mixed market conditions';

  const prompt = `You are the chief quant strategist for an Indian hedge fund. Write a concise market regime briefing.

CURRENT MARKET REGIME DATA:
- Regime: ${ctx.regime} (${description})
- ADX Strength: ${ctx.adxStrength ?? 'N/A'}
- RSI Level: ${ctx.rsiLevel ?? 'N/A'}
- Bollinger Band Width: ${ctx.bbWidthPct != null ? ctx.bbWidthPct.toFixed(2) + '%' : 'N/A'}
- MACD Signal: ${ctx.macdSignal ?? 'N/A'}
- Portfolio Win Rate (rolling): ${ctx.winRate != null ? ctx.winRate.toFixed(1) + '%' : 'N/A'}
- Sharpe Ratio (rolling): ${ctx.sharpeRatio != null ? ctx.sharpeRatio.toFixed(2) : 'N/A'}
- Open Positions: ${ctx.openPositions ?? 0}
- Active Watchlist: ${(ctx.topSymbols ?? []).join(', ')}

Respond ONLY in this JSON format (no markdown, pure JSON):
{
  "narrative": "3-4 sentence regime narrative explaining what the market is doing and why",
  "tacticalGuidance": "2-3 actionable trading tactics best suited for this specific regime",
  "watchOutFor": "1-2 key risk events or signals that would indicate regime change"
}`;

  try {
    const completion = await getGroq().chat.completions.create({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);

    const commentary: RegimeCommentary = {
      regimeName: ctx.regime,
      narrative: parsed.narrative || `Market is in ${description} phase.`,
      tacticalGuidance: parsed.tacticalGuidance || 'Follow momentum with strict risk management.',
      watchOutFor: parsed.watchOutFor || 'Monitor volume and price action for regime change signals.',
      generatedAt: new Date().toISOString(),
      source: 'groq',
    };

    regimeCache.commentary = commentary;
    regimeCache.ts = now;
    return commentary;

  } catch (err: any) {
    console.error('[LLM Intelligence] Regime commentary generation failed:', err?.message);

    const FALLBACK_TACTICS: Record<string, string> = {
      TRENDING_UP: 'Use Trend Follower strategy — buy pullbacks to EMA20. Add to winners, not losers.',
      TRENDING_DOWN: 'Avoid longs. Short on dead-cat bounces or sit in cash. Capital preservation mode.',
      SIDEWAYS: 'Use Mean Reversion — buy lower Bollinger Band, sell upper. Tight stops.',
      LOW_VOLATILITY: 'Watch for Bollinger Band squeeze breakout. Position size conservatively pre-breakout.',
      HIGH_VOLATILITY: 'Reduce position sizes by 50%. Use limit orders. Avoid chasing gaps.',
    };

    const commentary: RegimeCommentary = {
      regimeName: ctx.regime,
      narrative: `Market is currently in ${description}. ${ctx.adxStrength ? `ADX at ${ctx.adxStrength.toFixed(0)} confirms trend strength.` : ''} ${ctx.rsiLevel ? `RSI at ${ctx.rsiLevel.toFixed(0)}.` : ''}`,
      tacticalGuidance: FALLBACK_TACTICS[ctx.regime] || 'Apply standard risk management protocols.',
      watchOutFor: 'Watch for unexpected volume spikes, news events, or SEBI/RBI announcements.',
      generatedAt: new Date().toISOString(),
      source: 'fallback',
    };

    regimeCache.commentary = commentary;
    regimeCache.ts = now;
    return commentary;
  }
}
