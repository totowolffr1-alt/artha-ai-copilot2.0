import { Router, Request, Response } from 'express';
import axios from 'axios';
import { updateLastNewsFetch } from '../services/healthMonitor';

export const newsRouter = Router();

export interface NewsItem {
  headline: string;
  source: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  symbol: string | null;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  publishedAt: string;
  url?: string;
}

// ── Shared news cache export for Groq AI Context Injection (Fix 7) ───────────
export let newsCache: NewsItem[] = [
  { headline: 'CUPID Ltd receives WHO prequalification for latest product line', source: 'NSE Announcement', sentiment: 'BULLISH', confidence: 88, symbol: 'CUPID', impact: 'HIGH', publishedAt: new Date().toISOString() },
  { headline: 'FII net buyers in Indian equities for third consecutive session', source: 'Economic Times', sentiment: 'BULLISH', confidence: 78, symbol: null, impact: 'HIGH', publishedAt: new Date().toISOString() },
  { headline: 'SEBI tightens F&O margin requirements — impact on retail traders', source: 'MoneyControl', sentiment: 'BEARISH', confidence: 71, symbol: null, impact: 'HIGH', publishedAt: new Date().toISOString() },
  { headline: 'KPIT Technologies bags ₹200 Cr embedded software contract', source: 'MoneyControl', sentiment: 'BULLISH', confidence: 82, symbol: 'KPITTECH', impact: 'HIGH', publishedAt: new Date().toISOString() },
  { headline: 'Nifty Smallcap 250 outperforms benchmark for 4th consecutive week', source: 'Business Standard', sentiment: 'BULLISH', confidence: 73, symbol: 'NIFTY50', impact: 'MEDIUM', publishedAt: new Date().toISOString() },
];

export function getRecentNews(n = 5): NewsItem[] {
  return newsCache.slice(0, n);
}

// ── RSS feed fetcher ──────────────────────────────────────────────────────────
async function fetchRSS(url: string, source: string) {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 ArthAI/1.0' },
      timeout: 6000,
    });
    const items: any[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(data)) !== null) {
      const content = match[1];
      const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(content) || /<title>(.*?)<\/title>/.exec(content))?.[1] || '';
      const link = (/<link>(.*?)<\/link>/.exec(content))?.[1] || '';
      const pubDate = (/<pubDate>(.*?)<\/pubDate>/.exec(content))?.[1] || '';
      if (title) items.push({ title: title.trim(), link, pubDate, source });
    }
    return items.slice(0, 15);
  } catch {
    return [];
  }
}

// ── Sentiment classifier ──────────────────────────────────────────────────────
function classifySentiment(title: string): { sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; confidence: number } {
  const lower = title.toLowerCase();
  const bullish = ['surge', 'rally', 'gain', 'rise', 'high', 'profit', 'growth', 'record', 'beat', 'win', 'contract', 'order', 'approval', 'upgrade', 'buy', 'positive'];
  const bearish = ['fall', 'drop', 'loss', 'down', 'crash', 'slump', 'weak', 'sell', 'cut', 'reduce', 'lower', 'concern', 'risk', 'fraud', 'penalty', 'downgrade'];

  const bullScore = bullish.filter(w => lower.includes(w)).length;
  const bearScore = bearish.filter(w => lower.includes(w)).length;

  if (bullScore > bearScore) return { sentiment: 'BULLISH', confidence: Math.min(90, 60 + bullScore * 10) };
  if (bearScore > bullScore) return { sentiment: 'BEARISH', confidence: Math.min(90, 60 + bearScore * 10) };
  return { sentiment: 'NEUTRAL', confidence: 55 };
}

const SYMBOL_KEYWORDS: Record<string, string> = {
  'reliance': 'RELIANCE', 'tcs': 'TCS', 'infosys': 'INFY', 'wipro': 'WIPRO',
  'hdfc': 'HDFCBANK', 'icici': 'ICICIBANK', 'sbi': 'SBIN', 'kotak': 'KOTAKBANK',
  'bajaj finance': 'BAJFINANCE', 'tata motors': 'TATAMOTORS', 'zomato': 'ZOMATO',
  'paytm': 'PAYTM', 'cupid': 'CUPID', 'kpit': 'KPITTECH', 'irctc': 'IRCTC',
  'adani': 'ADANIPORTS', 'sun pharma': 'SUNPHARMA', 'asian paints': 'ASIANPAINT',
  'titan': 'TITAN', 'hal': 'HAL', 'ntpc': 'NTPC', 'ongc': 'ONGC',
  'nifty': 'NIFTY50', 'sensex': 'SENSEX', 'bank nifty': 'BANKNIFTY',
  'silverbees': 'SILVRBEES', 'goldbees': 'GOLDBEES',
};

function extractSymbol(title: string): string | null {
  const lower = title.toLowerCase();
  for (const [key, sym] of Object.entries(SYMBOL_KEYWORDS)) {
    if (lower.includes(key)) return sym;
  }
  return null;
}

export async function refreshNewsFeed() {
  const feeds = await Promise.all([
    fetchRSS('https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', 'Economic Times'),
    fetchRSS('https://www.moneycontrol.com/rss/buzzingstocks.xml', 'MoneyControl'),
    fetchRSS('https://www.business-standard.com/rss/markets-106.rss', 'Business Standard'),
  ]);

  const raw = feeds.flat();

  if (raw.length > 0) {
    newsCache = raw.map(item => {
      const { sentiment, confidence } = classifySentiment(item.title);
      const symbol = extractSymbol(item.title);
      return {
        headline: item.title,
        source: item.source,
        url: item.link,
        publishedAt: item.pubDate || new Date().toISOString(),
        sentiment,
        confidence,
        symbol,
        impact: confidence > 75 ? 'HIGH' : confidence > 60 ? 'MEDIUM' : 'LOW',
      };
    });
  }
  updateLastNewsFetch();
}

// ── News route ────────────────────────────────────────────────────────────────
newsRouter.get('/', async (req: Request, res: Response) => {
  const symbolFilter = req.query.symbol as string | undefined;

  try {
    await refreshNewsFeed();
  } catch (err) {
    console.error('[News] Refresh failed during request:', err);
  }

  const items = newsCache.filter(item => !symbolFilter || item.symbol === symbolFilter);
  res.json({ items: items.slice(0, 30) });
});
