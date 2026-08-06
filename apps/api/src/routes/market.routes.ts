import { Router, Request, Response } from 'express';
import axios from 'axios';
import type { IEventBus } from '../../../../packages/phase2-market-data/src/marketData/EventBus';
import type { MockMarketDataAdapter } from '../../../../packages/phase2-market-data/src/marketData/adapters/mock/MockAdapter';
import { toYahooTicker } from '../utils/yahooMapper';

export const marketRouter = Router();

let sharedBus: IEventBus | null = null;
let sharedAdapter: MockMarketDataAdapter | null = null;
export const latestTicks = new Map<string, { symbol: string; exchange: string; price: number; timestamp: string }>();

export function attachMarketData(bus: IEventBus, adapter: MockMarketDataAdapter) {
  sharedBus = bus;
  sharedAdapter = adapter;
  bus.on('TICK_RECEIVED', (event: any) => {
    const tick = event.tick;
    latestTicks.set(tick.symbol, {
      ...tick,
      marketOpen: tick.marketOpen ?? false,
    });
  });
}

// ── IST Market Session ────────────────────────────────────────────────────────
function getMarketSession() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const h = ist.getHours();
  const m = ist.getMinutes();
  const mins = h * 60 + m;

  const nextOpenIST = new Date(ist);
  if (day === 6) nextOpenIST.setDate(ist.getDate() + 2);
  else if (day === 0) nextOpenIST.setDate(ist.getDate() + 1);
  else if (mins >= 930) nextOpenIST.setDate(ist.getDate() + (day === 5 ? 3 : 1));
  nextOpenIST.setHours(9, 15, 0, 0);

  const isWeekend = day === 0 || day === 6;
  const isPreOpen = !isWeekend && mins >= 540 && mins < 555;
  const isOpen = !isWeekend && mins >= 555 && mins < 930;

  const countdown = Math.max(0, Math.floor((nextOpenIST.getTime() - now.getTime()) / 1000));

  return {
    isOpen,
    isPreOpen,
    isClosed: !isOpen && !isPreOpen,
    status: isOpen ? 'OPEN' : isPreOpen ? 'PRE_OPEN' : 'CLOSED',
    nextOpen: nextOpenIST.toISOString(),
    countdown,
    lastUpdated: now.toISOString(),
    closingTime: '15:30 IST',
    message: isOpen
      ? 'Market is OPEN — Live prices active'
      : isPreOpen
      ? 'Pre-Open session (09:00–09:15 IST)'
      : 'Market CLOSED — Prices frozen at last close',
  };
}

// ── Fix 6: Corrected Timeframe Range Map ─────────────────────────────────────
const RANGE_MAP: Record<string, { range: string; interval: string }> = {
  '1D':  { range: '1d',  interval: '1m'  },
  '5D':  { range: '5d',  interval: '5m'  },
  '1M':  { range: '1mo', interval: '15m' }, // Fix: 15m candles
  '3M':  { range: '3mo', interval: '30m' }, // Fix: 30m candles
  '6M':  { range: '6mo', interval: '60m' }, // Fix: 60m candles
  '1Y':  { range: '1y',  interval: '1d'  }, // Fix: Daily candles for 1Y
  '3Y':  { range: '3y',  interval: '1wk' },
  '5Y':  { range: '5y',  interval: '1wk' }, // Fix: Weekly candles for 5Y
  'MAX': { range: 'max', interval: '1mo' },
};

function generateFallbackCandles(symbol: string, range: string, basePrice: number = 200) {
  const countMap: Record<string, number> = {
    '1D': 75, '5D': 100, '1M': 120, '3M': 150, '6M': 180, '1Y': 250, '3Y': 300, '5Y': 350, 'MAX': 400
  };
  const count = countMap[range] || 150;
  const candles = [];
  let price = basePrice || 200;
  const now = Date.now();
  const stepMs = range === '1D' ? 5 * 60000 : range === '5D' ? 30 * 60000 : 24 * 3600 * 1000;

  for (let i = count; i >= 0; i--) {
    const change = (Math.random() - 0.49) * price * 0.012;
    const open = price;
    price = Math.max(1, price + change);
    const high = Math.max(open, price) * (1 + Math.random() * 0.005);
    const low = Math.min(open, price) * (1 - Math.random() * 0.005);
    const volume = Math.floor(Math.random() * 50000) + 5000;

    candles.push({
      timestamp: new Date(now - i * stepMs).toISOString(),
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(price.toFixed(2)),
      volume,
    });
  }
  return candles;
}

export async function fetchYahooFinance(symbol: string, range: string, interval: string) {
  const ticker = toYahooTicker(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
  const { data } = await axios.get(url, {
    params: { range, interval, includePrePost: false },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
    timeout: 6000,
  });

  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('No data from Yahoo Finance');

  const timestamps: number[] = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const { open = [], high = [], low = [], close = [], volume = [] } = quote;

  const candles = timestamps.map((ts: number, i: number) => ({
    timestamp: new Date(ts * 1000).toISOString(),
    open: parseFloat((open[i] || 0).toFixed(2)),
    high: parseFloat((high[i] || 0).toFixed(2)),
    low: parseFloat((low[i] || 0).toFixed(2)),
    close: parseFloat((close[i] || 0).toFixed(2)),
    volume: volume[i] || 0,
  })).filter((c: any) => c.close > 0);

  if (candles.length === 0) throw new Error('Empty candles from Yahoo');
  return candles;
}

// ── Fix 5: Comprehensive NSE Search List including ETFs (SilverBeES, GoldBeES, etc.) ──
const LOCAL_NSE_SEARCH_LIST = [
  // ETFs
  { symbol: 'SILVERBEES', name: 'Nippon India ETF Silver BeES', exchange: 'NSE' },
  { symbol: 'GOLDBEES', name: 'Nippon India ETF Gold BeES', exchange: 'NSE' },
  { symbol: 'NIFTYBEES', name: 'Nippon India ETF Nifty BeES', exchange: 'NSE' },
  { symbol: 'BANKBEES', name: 'Nippon India ETF Bank BeES', exchange: 'NSE' },
  { symbol: 'JUNIORBEES', name: 'Nippon India ETF Junior BeES', exchange: 'NSE' },
  { symbol: 'ITBEES', name: 'Nippon India ETF IT BeES', exchange: 'NSE' },
  { symbol: 'PHARMABEES', name: 'Nippon India ETF Pharma BeES', exchange: 'NSE' },
  { symbol: 'MON100', name: 'Motilal Oswal Nasdaq 100 ETF', exchange: 'NSE' },
  { symbol: 'ICICIB22', name: 'ICICI Prudential BHARAT 22 ETF', exchange: 'NSE' },
  { symbol: 'MAFANG', name: 'Mirae Asset NYSE FANG+ ETF', exchange: 'NSE' },
  
  // Equities & Indices
  { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE' },
  { symbol: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE' },
  { symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', exchange: 'NSE' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', exchange: 'NSE' },
  { symbol: 'WIPRO', name: 'Wipro Ltd', exchange: 'NSE' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors Ltd', exchange: 'NSE' },
  { symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance Ltd', exchange: 'NSE' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', exchange: 'NSE' },
  { symbol: 'ZOMATO', name: 'Zomato Ltd', exchange: 'NSE' },
  { symbol: 'PAYTM', name: 'One97 Communications (Paytm)', exchange: 'NSE' },
  { symbol: 'CUPID', name: 'Cupid Ltd', exchange: 'NSE' },
  { symbol: 'KPITTECH', name: 'KPIT Technologies Ltd', exchange: 'NSE' },
  { symbol: 'BANDHANBNK', name: 'Bandhan Bank Ltd', exchange: 'NSE' },
  { symbol: 'IRCTC', name: 'Indian Railway Catering & Tourism', exchange: 'NSE' },
  { symbol: 'ADANIPORTS', name: 'Adani Ports and SEZ Ltd', exchange: 'NSE' },
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries', exchange: 'NSE' },
  { symbol: 'DIVISLAB', name: "Divi's Laboratories Ltd", exchange: 'NSE' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints Ltd', exchange: 'NSE' },
  { symbol: 'TITAN', name: 'Titan Company Ltd', exchange: 'NSE' },
  { symbol: 'LTIM', name: 'LTIMindtree Ltd', exchange: 'NSE' },
  { symbol: 'HCLTECH', name: 'HCL Technologies Ltd', exchange: 'NSE' },
  { symbol: 'ONGC', name: 'Oil and Natural Gas Corporation', exchange: 'NSE' },
  { symbol: 'NTPC', name: 'NTPC Ltd', exchange: 'NSE' },
  { symbol: 'POWERGRID', name: 'Power Grid Corporation of India', exchange: 'NSE' },
  { symbol: 'COALINDIA', name: 'Coal India Ltd', exchange: 'NSE' },
  { symbol: 'HAL', name: 'Hindustan Aeronautics Ltd', exchange: 'NSE' },
  { symbol: 'BHEL', name: 'Bharat Heavy Electricals Ltd', exchange: 'NSE' },
  { symbol: 'TATAPOWER', name: 'Tata Power Company Ltd', exchange: 'NSE' },
  { symbol: 'TATASTEEL', name: 'Tata Steel Ltd', exchange: 'NSE' },
  { symbol: 'AXISBANK', name: 'Axis Bank Ltd', exchange: 'NSE' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki India Ltd', exchange: 'NSE' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement Ltd', exchange: 'NSE' },
  { symbol: 'NESTLEIND', name: 'Nestle India Ltd', exchange: 'NSE' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', exchange: 'NSE' },
  { symbol: 'ITC', name: 'ITC Ltd', exchange: 'NSE' },
  { symbol: 'NIFTY50', name: 'Nifty 50 Index', exchange: 'NSE' },
  { symbol: 'BANKNIFTY', name: 'Bank Nifty Index', exchange: 'NSE' },
  { symbol: 'MIDCAP150', name: 'Nifty Midcap 150 Index', exchange: 'NSE' },
];

// ── ROUTES ────────────────────────────────────────────────────────────────────

marketRouter.get('/session', (_req: Request, res: Response) => {
  res.json(getMarketSession());
});

// Fix 5: Search with local ETF index + Yahoo Finance Fallback
marketRouter.get('/search', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  if (!q || q.length < 1) return res.json({ results: [] });

  const localMatches = LOCAL_NSE_SEARCH_LIST.filter(s =>
    s.symbol.toLowerCase().includes(q) ||
    s.name.toLowerCase().includes(q)
  );

  if (localMatches.length >= 3) {
    return res.json({ results: localMatches.slice(0, 10) });
  }

  // Fallback to Yahoo Finance Search API for 100% NSE/BSE instrument coverage
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 3000,
    });

    const yahooQuotes: any[] = data?.quotes || [];
    const remoteMatches = yahooQuotes
      .filter((item: any) => item.symbol && (item.symbol.endsWith('.NS') || item.symbol.endsWith('.BO')))
      .map((item: any) => ({
        symbol: item.symbol.replace(/\.(NS|BO)$/, ''),
        name: item.longname || item.shortname || item.symbol,
        exchange: item.symbol.endsWith('.BO') ? 'BSE' : 'NSE',
      }));

    const combined = [...localMatches, ...remoteMatches];
    const unique = Array.from(new Map(combined.map(item => [item.symbol, item])).values());
    return res.json({ results: unique.slice(0, 10) });
  } catch {
    return res.json({ results: localMatches.slice(0, 10) });
  }
});

marketRouter.get('/watchlist', (_req: Request, res: Response) => {
  const watchlist = [
    { ticker: 'RELIANCE', exchange: 'NSE' },
    { ticker: 'TCS', exchange: 'NSE' },
    { ticker: 'INFY', exchange: 'NSE' },
    { ticker: 'CUPID', exchange: 'NSE' },
    { ticker: 'ZOMATO', exchange: 'NSE' },
    { ticker: 'SILVERBEES', exchange: 'NSE' },
  ].map(item => {
    const cached = latestTicks.get(item.ticker);
    return {
      ...item,
      symbol: item.ticker,
      price: cached?.price || BASE_PRICES[item.ticker] || (item.ticker === 'SILVERBEES' ? 344.44 : 100),
      last_price: cached?.price || BASE_PRICES[item.ticker] || (item.ticker === 'SILVERBEES' ? 344.44 : 100),
    };
  });
  res.json({ watchlist });
});

const BASE_PRICES: Record<string, number> = {
  RELIANCE: 2880, TCS: 3600, INFY: 1590, HDFCBANK: 1330, ICICIBANK: 1240,
  WIPRO: 540, TATAMOTORS: 960, SBIN: 820, BAJFINANCE: 7200, ZOMATO: 265,
  PAYTM: 880, CUPID: 215, KPITTECH: 1680, BANDHANBNK: 210, IRCTC: 880,
  ADANIPORTS: 1340, SUNPHARMA: 1720, ASIANPAINT: 2450, TITAN: 3300,
};

// Cache to avoid spamming Yahoo Finance chart API within a short timeframe
const quotesCache = new Map<string, { quote: any; fetchedAt: number }>();
const QUOTE_CACHE_TTL = 3000; // 3 seconds cache

marketRouter.get('/quotes', async (req: Request, res: Response) => {
  const symbolsQuery = String(req.query.symbols || '');
  if (!symbolsQuery) return res.json({ quotes: [] });

  const symbols = symbolsQuery.split(',');

  const fetchSingleQuote = async (symbol: string) => {
    const upper = symbol.toUpperCase().trim();
    const cacheKey = upper;

    // Check cache
    const cached = quotesCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < QUOTE_CACHE_TTL) {
      return cached.quote;
    }

    const base = BASE_PRICES[upper] || 200;
    const ticker = toYahooTicker(upper);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`;

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        timeout: 4000,
      });

      const meta = response.data?.chart?.result?.[0]?.meta;
      if (meta) {
        const ltp = meta.regularMarketPrice || meta.previousClose || base;
        const prevClose = meta.chartPreviousClose || meta.previousClose || base;
        const change = ltp - prevClose;
        const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

        const quote = {
          symbol: upper,
          ltp: parseFloat(ltp.toFixed(2)),
          open: parseFloat((meta.regularMarketOpen || prevClose).toFixed(2)),
          high: parseFloat((meta.regularMarketDayHigh || ltp).toFixed(2)),
          low: parseFloat((meta.regularMarketDayLow || ltp).toFixed(2)),
          prevClose: parseFloat(prevClose.toFixed(2)),
          change: parseFloat(change.toFixed(2)),
          changePct: parseFloat(changePct.toFixed(2)),
          volume: meta.regularMarketVolume || 10000,
        };

        quotesCache.set(cacheKey, { quote, fetchedAt: Date.now() });
        return quote;
      }
    } catch (err: any) {
      console.warn(`[Quotes] Fallback for ${symbol} due to error: ${err.message}`);
    }

    // Default fallback if API fails
    return {
      symbol: upper,
      ltp: base,
      open: base,
      high: base,
      low: base,
      prevClose: base,
      change: 0,
      changePct: 0,
      volume: 10000,
    };
  };

  try {
    const results = await Promise.all(symbols.map(s => fetchSingleQuote(s)));
    // Save to latestTicks cache so other services can query
    results.forEach(q => {
      latestTicks.set(q.symbol, {
        symbol: q.symbol,
        exchange: 'NSE',
        price: q.ltp,
        timestamp: new Date().toISOString(),
      });
    });
    return res.json({ quotes: results });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Single-symbol live price (direct Yahoo Finance, no WebSocket needed) ────
marketRouter.get('/live-price', async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'RELIANCE');
  const ticker = toYahooTicker(symbol);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await r.json() as any;
    const meta  = json?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('No meta');
    return res.json({
      symbol,
      exchange:      String(req.query.exchange || 'NSE'),
      price:         meta.regularMarketPrice || meta.previousClose,
      high:          meta.regularMarketDayHigh,
      low:           meta.regularMarketDayLow,
      open:          meta.chartPreviousClose,
      previousClose: meta.chartPreviousClose,
      volume:        meta.regularMarketVolume,
      timestamp:     new Date().toISOString(),
    });
  } catch (err: any) {
    // fallback: return from latestTicks if available
    const tick = latestTicks.get(symbol);
    if (tick) return res.json({ ...tick, timestamp: new Date().toISOString() });
    return res.status(502).json({ error: err.message });
  }
});


marketRouter.get('/ticks', (_req: Request, res: Response) => {
  const session = getMarketSession();
  const ticks = Array.from(latestTicks.values()).map(t => ({
    ...t,
    status: session.isOpen ? 'LIVE' : session.isPreOpen ? 'PRE_OPEN' : 'CLOSE',
    marketOpen: session.isOpen,
  }));
  res.json({ ticks, session: { isOpen: session.isOpen, status: session.status } });
});

marketRouter.get('/historical', async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'RELIANCE');
  const range = String(req.query.range || '1M');
  const session = getMarketSession();

  const mapped = RANGE_MAP[range] || RANGE_MAP['1M'];

  try {
    const candles = await fetchYahooFinance(symbol, mapped.range, mapped.interval);
    return res.json({
      symbol,
      range,
      interval: mapped.interval,
      marketStatus: session.status,
      count: candles.length,
      candles,
    });
  } catch (err: any) {
    console.warn(`[Historical] ${symbol} external fetch failed (${err.message}). Generating fallback chart candles.`);
    const tick = latestTicks.get(symbol.toUpperCase());
    const basePrice = tick?.price || (symbol.includes('BEES') ? 344.44 : 500);
    const candles = generateFallbackCandles(symbol, range, basePrice);
    return res.json({
      symbol,
      range,
      interval: mapped.interval,
      marketStatus: session.status,
      count: candles.length,
      isFallback: true,
      candles,
    });
  }
});

marketRouter.get('/candles', async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'RELIANCE');
  try {
    const candles = await fetchYahooFinance(symbol, '5d', '5m');
    return res.json({ symbol, candles });
  } catch {
    const tick = latestTicks.get(symbol.toUpperCase());
    const basePrice = tick?.price || (symbol.includes('BEES') ? 344.44 : 500);
    const candles = generateFallbackCandles(symbol, '5D', basePrice);
    return res.json({ symbol, isFallback: true, candles });
  }
});

marketRouter.get('/movers', async (_req: Request, res: Response) => {
  res.json({
    gainers: [
      { symbol: 'CUPID', name: 'Cupid Ltd', change: 8.2, price: 215.4, volume: 450000 },
      { symbol: 'KPITTECH', name: 'KPIT Technologies', change: 4.1, price: 1680, volume: 230000 },
      { symbol: 'HAL', name: 'Hindustan Aeronautics', change: 3.7, price: 4120, volume: 180000 },
    ],
    losers: [
      { symbol: 'PAYTM', name: 'Paytm', change: -3.2, price: 880, volume: 890000 },
      { symbol: 'ZOMATO', name: 'Zomato', change: -1.8, price: 265, volume: 560000 },
    ],
    upperCircuit: [
      { symbol: 'CUPID', name: 'Cupid Ltd', circuit: 10, price: 215.4 },
    ],
    lowerCircuit: [],
  });
});

marketRouter.get('/stream', (req: Request, res: Response) => {
  if (!sharedBus) return res.status(503).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Immediately send all current cached ticks so the UI populates instantly
  for (const tick of latestTicks.values()) {
    res.write(`data: ${JSON.stringify(tick)}\n\n`);
  }

  const unsubscribe = sharedBus.on('TICK_RECEIVED', (event: any) => {
    res.write(`data: ${JSON.stringify(event.tick)}\n\n`);
  });

  req.on('close', () => {
    unsubscribe();
    res.end();
  });
});
