import axios from 'axios';

interface PriceQuote {
  symbol: string;
  close: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  change: number;
  changePct: number;
  volume: number;
  updatedAt: string;
}

const cache = new Map<string, { data: PriceQuote; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchLastPrice(symbol: string): Promise<PriceQuote | null> {
  const upper = symbol.toUpperCase().trim();
  const cached = cache.get(upper);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const ticker = upper.includes('.') ? upper : `${upper}.NS`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
    const { data } = await axios.get(url, {
      params: { range: '1d', interval: '1d', includePrePost: false },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 5000,
    });

    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const quote = result.indicators?.quote?.[0] || {};
    
    const close = meta.regularMarketPrice || quote.close?.[0] || 0;
    const prevClose = meta.chartPreviousClose || meta.previousClose || close;
    const open = quote.open?.[0] || close;
    const high = quote.high?.[0] || close;
    const low = quote.low?.[0] || close;
    const volume = quote.volume?.[0] || 0;
    
    const change = close - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    const priceQuote: PriceQuote = {
      symbol: upper,
      close: parseFloat(close.toFixed(2)),
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      prevClose: parseFloat(prevClose.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
      changePct: parseFloat(changePct.toFixed(2)),
      volume,
      updatedAt: new Date().toISOString(),
    };

    cache.set(upper, { data: priceQuote, timestamp: Date.now() });
    return priceQuote;
  } catch (err: any) {
    console.error(`[PriceCache] Failed to fetch price for ${upper}:`, err.message);
    return null;
  }
}
