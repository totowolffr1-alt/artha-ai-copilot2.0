import https from 'https';

export interface NewsItem {
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number; // -1 to +1
  symbol?: string;
}

const NEWS_API_KEY = process.env.NEWS_API_KEY ?? '';

// Keywords for sentiment detection
const BULLISH_WORDS = ['rally', 'surge', 'gain', 'profit', 'beat', 'record', 'high', 'upgrade', 'buy', 'strong', 'growth', 'positive', 'up', 'rise', 'boost', 'expand', 'win', 'approve'];
const BEARISH_WORDS = ['fall', 'drop', 'crash', 'loss', 'miss', 'downgrade', 'sell', 'weak', 'decline', 'negative', 'down', 'reduce', 'concern', 'risk', 'warning', 'cut', 'reject', 'probe'];

function scoreSentiment(text: string): { sentiment: 'positive' | 'negative' | 'neutral'; score: number } {
  const lower = text.toLowerCase();
  let bullish = 0;
  let bearish = 0;

  BULLISH_WORDS.forEach(w => { if (lower.includes(w)) bullish++; });
  BEARISH_WORDS.forEach(w => { if (lower.includes(w)) bearish++; });

  const total = bullish + bearish;
  if (total === 0) return { sentiment: 'neutral', score: 0 };

  const score = (bullish - bearish) / total; // -1 to +1
  if (score > 0.1) return { sentiment: 'positive', score };
  if (score < -0.1) return { sentiment: 'negative', score };
  return { sentiment: 'neutral', score };
}

function detectSymbol(text: string): string | undefined {
  const SYMBOL_MAP: Record<string, string> = {
    'reliance': 'RELIANCE', 'tcs': 'TCS', 'infosys': 'INFY', 'infy': 'INFY',
    'hdfc bank': 'HDFCBANK', 'hdfcbank': 'HDFCBANK', 'icici bank': 'ICICIBANK',
    'wipro': 'WIPRO', 'bajaj': 'BAJFINANCE', 'adani': 'ADANIENT',
    'nifty': 'NIFTY50', 'sensex': 'SENSEX', 'rbi': 'MACRO',
    'sebi': 'MACRO', 'fii': 'MACRO', 'crude': 'MACRO',
  };

  const lower = text.toLowerCase();
  for (const [key, sym] of Object.entries(SYMBOL_MAP)) {
    if (lower.includes(key)) return sym;
  }
  return undefined;
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

let cache: { items: NewsItem[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function fetchLiveNews(): Promise<NewsItem[]> {
  // Return cache if fresh
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.items;
  }

  if (!NEWS_API_KEY) {
    console.warn('[NewsService] No NEWS_API_KEY set, returning empty news');
    return [];
  }

  try {
    // Search for Indian stock market news
    const queries = [
      'NSE OR BSE OR NIFTY stock India',
      'Sensex Nifty India market',
    ];

    const query = encodeURIComponent(queries[0]);
    const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${NEWS_API_KEY}`;

    const data = await fetchJson(url);

    if (data.status !== 'ok' || !Array.isArray(data.articles)) {
      console.warn('[NewsService] NewsAPI returned unexpected format:', data.status);
      return [];
    }

    const items: NewsItem[] = data.articles.map((a: any) => {
      const text = `${a.title ?? ''} ${a.description ?? ''}`;
      const { sentiment, score } = scoreSentiment(text);
      const symbol = detectSymbol(text);

      return {
        headline: a.title ?? '',
        source: a.source?.name ?? 'Unknown',
        url: a.url ?? '',
        publishedAt: a.publishedAt ?? new Date().toISOString(),
        sentiment,
        sentimentScore: score,
        symbol,
      };
    }).filter((item: NewsItem) => item.headline.length > 10);

    cache = { items, fetchedAt: Date.now() };
    console.log(`[NewsService] ✅ Fetched ${items.length} live news articles`);
    return items;
  } catch (err: any) {
    console.error('[NewsService] Failed to fetch news:', err?.message ?? err);
    return [];
  }
}

// Returns the aggregate sentiment score for a given symbol from recent news (-1 to +1)
export async function getSymbolSentiment(symbol: string): Promise<{ score: number; articles: number }> {
  const news = await fetchLiveNews();
  const relevant = news.filter(n => !n.symbol || n.symbol === symbol || n.symbol === 'MACRO');
  if (relevant.length === 0) return { score: 0, articles: 0 };

  const avgScore = relevant.reduce((sum, n) => sum + n.sentimentScore, 0) / relevant.length;
  return { score: avgScore, articles: relevant.length };
}
