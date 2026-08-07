import { Router, Request, Response } from 'express';
import { runAgentChat, runProactiveScreening, AgentSuggestion } from '../services/aiAgentService';
import { fetchLiveNews } from '../services/newsService';
import { getFundamentals } from '../services/fmpService';
import { getCachedHoldings } from '../services/brokerSession';

export const agentRouter = Router();

// ── In-memory suggestion store (acts as notification queue) ───────────────────
let activeSuggestions: AgentSuggestion[] = [
  {
    symbol: 'CUPID',
    direction: 'LONG',
    confidence: 88,
    strategy: 'delivery',
    reasoning: 'Strong fundamental rating (STRONG_BUY, P/E 24.5) combined with high growth score and positive news momentum.',
    target: 285.00,
    stopLoss: 235.00,
    fundamentalRating: 'STRONG_BUY',
    sentimentScore: 0.45,
    generatedAt: new Date().toISOString(),
  },
  {
    symbol: 'RELIANCE',
    direction: 'LONG',
    confidence: 82,
    strategy: 'swing',
    reasoning: 'High analyst score (82%), bullish market regime, solid fundamentals (P/E 24.1, ROE 14.5%).',
    target: 3120.00,
    stopLoss: 2820.00,
    fundamentalRating: 'BUY',
    sentimentScore: 0.32,
    generatedAt: new Date().toISOString(),
  },
  {
    symbol: 'TCS',
    direction: 'LONG',
    confidence: 76,
    strategy: 'delivery',
    reasoning: 'Institutional buying interest, robust ROE (38.2%), positive sentiment score (+0.28).',
    target: 3850.00,
    stopLoss: 3520.00,
    fundamentalRating: 'BUY',
    sentimentScore: 0.28,
    generatedAt: new Date().toISOString(),
  },
];
let lastScreenedAt: Date | null = new Date();

// ── Helper: get user portfolio context for AI ──────────────────────────────────
function getPortfolioContext(): string {
  const cached = getCachedHoldings();
  if (!cached || cached.holdings.length === 0) {
    return 'User has no current holdings in demat.';
  }
  const lines = cached.holdings.map((h: any) =>
    `${h.symbol}: ${h.qty} shares @ avg ₹${h.avgPrice} | LTP ₹${h.ltp} | P&L: ₹${h.pnl} (${h.pnlPct}%)`
  );
  return `User's current holdings:\n${lines.join('\n')}\nTotal portfolio value: ₹${cached.totalValue?.toFixed(2) ?? 'N/A'}`;
}

// ── Chat with AI Agent (with tool logs) ───────────────────────────────────────
agentRouter.post('/chat', async (req: Request, res: Response) => {
  const { message } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    // Inject portfolio context into message so AI is portfolio-aware
    const portfolioContext = getPortfolioContext();
    const enrichedMessage = `${message}\n\n[PORTFOLIO CONTEXT]\n${portfolioContext}`;

    const result = await runAgentChat(enrichedMessage);

    // Store any high-confidence suggestions
    if (result.suggestions.length > 0) {
      const newSymbols = new Set(result.suggestions.map((s: AgentSuggestion) => s.symbol));
      activeSuggestions = [
        ...activeSuggestions.filter((s: AgentSuggestion) => !newSymbols.has(s.symbol)),
        ...result.suggestions,
      ].slice(0, 20);
    }

    res.json({
      reply: result.reply,
      suggestions: result.suggestions,
      toolsUsed: result.toolsUsed ?? [],
      portfolioAware: true,
      ai: true,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Agent error' });
  }
});

// ── Get Active Suggestions ────────────────────────────────────────────────────
agentRouter.get('/suggestions', (_req: Request, res: Response) => {
  const sorted = [...activeSuggestions].sort((a, b) => b.confidence - a.confidence);
  res.json({
    suggestions: sorted.slice(0, 10),
    lastScreenedAt: lastScreenedAt?.toISOString() ?? null,
    count: sorted.length,
  });
});

// ── Trigger Proactive Screen ──────────────────────────────────────────────────
agentRouter.post('/screen', async (_req: Request, res: Response) => {
  try {
    const portfolioContext = getPortfolioContext();
    const result = await runAgentChat(
      `Screen the watchlist for high-confidence trading opportunities. ` +
      `Check fundamentals and news sentiment. Return suggestions with confidence ≥ 70%.\n\n` +
      `[PORTFOLIO CONTEXT]\n${portfolioContext}`
    );

    activeSuggestions = result.suggestions;
    lastScreenedAt = new Date();

    res.json({
      suggestions: result.suggestions,
      count: result.suggestions.length,
      screened: true,
      timestamp: lastScreenedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Screening error' });
  }
});

// ── Live News Feed ────────────────────────────────────────────────────────────
agentRouter.get('/news', async (_req: Request, res: Response) => {
  try {
    const news = await fetchLiveNews();
    res.json({
      items: news,
      count: news.length,
      lastUpdated: new Date().toISOString(),
      source: news.length > 0 ? 'NewsAPI (Live)' : 'No data (check NEWS_API_KEY)',
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'News fetch error' });
  }
});

// ── Fundamentals Lookup ───────────────────────────────────────────────────────
agentRouter.get('/fundamentals/:symbol', async (req: Request, res: Response) => {
  const { symbol } = req.params;
  try {
    const data = await getFundamentals(symbol.toUpperCase());
    if (!data) return res.status(404).json({ error: `No fundamentals found for ${symbol}` });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Fundamentals fetch error' });
  }
});

// ── Dismiss a suggestion ──────────────────────────────────────────────────────
agentRouter.delete('/suggestions/:symbol', (req: Request, res: Response) => {
  const { symbol } = req.params;
  activeSuggestions = activeSuggestions.filter(s => s.symbol !== symbol.toUpperCase());
  res.json({ dismissed: symbol, remaining: activeSuggestions.length });
});

// ── Portfolio context (for AI to read) ───────────────────────────────────────
agentRouter.get('/portfolio-context', (_req: Request, res: Response) => {
  const cached = getCachedHoldings();
  res.json({
    holdings: cached?.holdings ?? [],
    totalValue: cached?.totalValue ?? 0,
    overallPnl: cached?.overallPnl ?? 0,
    hasCached: !!cached,
  });
});
