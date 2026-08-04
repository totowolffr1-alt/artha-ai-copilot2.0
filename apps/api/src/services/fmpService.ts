import https from 'https';

export interface FundamentalsData {
  symbol: string;
  companyName: string;
  price: number;
  pe: number;          // Price to Earnings
  eps: number;         // Earnings Per Share
  marketCap: number;   // in crore INR
  revenue: number;     // annual revenue in crore INR
  netIncome: number;
  debtToEquity: number;
  roe: number;         // Return on Equity %
  dividendYield: number;
  sector: string;
  rating: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  analystScore: number; // 0-100
}

const FMP_API_KEY = process.env.FMP_API_KEY ?? '';

// Map NSE symbols to FMP-compatible tickers (FMP uses exchange suffix)
const NSE_TO_FMP: Record<string, string> = {
  'RELIANCE': 'RELIANCE.NS',
  'TCS': 'TCS.NS',
  'INFY': 'INFY',        // INFY listed on NYSE too
  'HDFCBANK': 'HDB',     // NYSE ADR
  'ICICIBANK': 'IBN',    // NYSE ADR
  'WIPRO': 'WIT',        // NYSE ADR
  'BAJFINANCE': 'BAJFINANCE.NS',
  'ADANIENT': 'ADANIENT.NS',
  'KOTAKBANK': 'KOTAKBANK.NS',
  'SBIN': 'SBIN.NS',
  'NIFTY50': '^NSEI',
};

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

// Cache fundamentals for 1 hour (they don't change minute by minute)
const fundamentalsCache = new Map<string, { data: FundamentalsData; fetchedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function computeRating(pe: number, roe: number, debtToEquity: number, eps: number): 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' {
  let score = 50;

  // P/E Analysis (lower is better for value, but not negative)
  if (pe > 0 && pe < 15) score += 20;
  else if (pe > 0 && pe < 25) score += 10;
  else if (pe > 40) score -= 15;

  // ROE Analysis (higher is better)
  if (roe > 20) score += 15;
  else if (roe > 12) score += 8;
  else if (roe < 5) score -= 10;

  // Debt to Equity (lower is better)
  if (debtToEquity < 0.5) score += 10;
  else if (debtToEquity > 2) score -= 15;

  // EPS positive = good
  if (eps > 0) score += 5;
  else score -= 20;

  if (score >= 80) return 'STRONG_BUY';
  if (score >= 65) return 'BUY';
  if (score >= 45) return 'HOLD';
  if (score >= 30) return 'SELL';
  return 'STRONG_SELL';
}

export async function getFundamentals(nseSymbol: string): Promise<FundamentalsData | null> {
  // Check cache
  const cached = fundamentalsCache.get(nseSymbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  if (!FMP_API_KEY) {
    console.warn('[FMPService] No FMP_API_KEY set');
    return null;
  }

  const ticker = NSE_TO_FMP[nseSymbol] ?? `${nseSymbol}.NS`;

  try {
    // Fetch company profile + key metrics
    const profileUrl = `https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${FMP_API_KEY}`;
    const metricsUrl = `https://financialmodelingprep.com/api/v3/key-metrics/${ticker}?period=annual&limit=1&apikey=${FMP_API_KEY}`;
    const ratioUrl   = `https://financialmodelingprep.com/api/v3/ratios/${ticker}?period=annual&limit=1&apikey=${FMP_API_KEY}`;

    const [profileData, metricsData, ratioData] = await Promise.all([
      fetchJson(profileUrl),
      fetchJson(metricsUrl),
      fetchJson(ratioUrl),
    ]);

    const profile = Array.isArray(profileData) ? profileData[0] : profileData;
    const metrics = Array.isArray(metricsData) ? metricsData[0] : {};
    const ratio   = Array.isArray(ratioData)   ? ratioData[0]   : {};

    if (!profile || !profile.companyName) {
      console.warn(`[FMPService] No profile data for ${ticker}`);
      return null;
    }

    const pe             = profile.pe             ?? metrics.peRatio         ?? 0;
    const eps            = profile.eps            ?? 0;
    const roe            = (metrics.roe           ?? 0) * 100; // convert to %
    const debtToEquity   = metrics.debtToEquity   ?? ratio.debtEquityRatio   ?? 0;
    const dividendYield  = (profile.lastDiv       ?? 0) / (profile.price ?? 1) * 100;
    const marketCapCr    = (profile.mktCap        ?? 0) / 1e7; // USD to crore approx (rough)

    const rating = computeRating(pe, roe, debtToEquity, eps);
    const analystScore = Math.min(100, Math.max(0,
      (pe > 0 && pe < 25 ? 20 : 0) +
      (roe > 15 ? 25 : roe > 8 ? 15 : 0) +
      (eps > 0 ? 20 : 0) +
      (debtToEquity < 1 ? 15 : 0) +
      20 // base
    ));

    const data: FundamentalsData = {
      symbol: nseSymbol,
      companyName: profile.companyName ?? nseSymbol,
      price: profile.price ?? 0,
      pe,
      eps,
      marketCap: marketCapCr,
      revenue: (profile.revenue ?? 0) / 1e7,
      netIncome: (profile.netIncome ?? 0) / 1e7,
      debtToEquity,
      roe,
      dividendYield,
      sector: profile.sector ?? 'Unknown',
      rating,
      analystScore,
    };

    fundamentalsCache.set(nseSymbol, { data, fetchedAt: Date.now() });
    console.log(`[FMPService] ✅ Fetched fundamentals for ${nseSymbol} (${ticker}): PE=${pe.toFixed(1)}, ROE=${roe.toFixed(1)}%`);
    return data;

  } catch (err: any) {
    console.error(`[FMPService] Failed to fetch fundamentals for ${nseSymbol}:`, err?.message ?? err);
    return null;
  }
}

// Batch fetch for watchlist
export async function getBatchFundamentals(symbols: string[]): Promise<Record<string, FundamentalsData | null>> {
  const results = await Promise.all(symbols.map(s => getFundamentals(s)));
  return Object.fromEntries(symbols.map((s, i) => [s, results[i]]));
}
