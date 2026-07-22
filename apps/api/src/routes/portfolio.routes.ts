/**
 * portfolio.routes.ts
 * Uses shared brokerSession singleton — no duplicate auth, no rate limiting.
 * Holdings cached for 2 minutes to prevent AG8002 "Access denied" errors.
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import {
  getJwtToken,
  getApiHeaders,
  getCachedHoldings,
  setCachedHoldings,
  clearSession,
  getSessionStatus,
} from '../services/brokerSession';

export const portfolioRouter = Router();

// ── Fetch Real Demat Holdings ──────────────────────────────────────────────────
async function fetchRealHoldings() {
  // Return cached data if still fresh (2-minute window)
  const cached = getCachedHoldings();
  if (cached) {
    console.log('[Portfolio] Using cached holdings (2-min window active)');
    return cached;
  }

  const token = await getJwtToken();
  if (!token) return null;

  const headers = await getApiHeaders();
  const endpoints = [
    'https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getHolding',
    'https://apiconnect.angelbroking.com/rest/secure/angelbroking/portfolio/v1/getHolding',
  ];

  for (const endpoint of endpoints) {
    try {
      const { data } = await axios.get(endpoint, { headers, timeout: 8000 });

      if (data?.status === true && data?.data) {
        let rawList: any[] = [];
        if (Array.isArray(data.data)) rawList = data.data;
        else if (Array.isArray(data.data?.holdings)) rawList = data.data.holdings;
        else if (Array.isArray(data.data?.holding))  rawList = data.data.holding;

        const holdings = rawList.map(h => {
          const qty        = Math.abs(parseInt(h.quantity || h.realisedquantity || '0', 10));
          const avgPrice   = parseFloat(h.averageprice || h.avgprice || '0');
          const ltp        = parseFloat(h.ltp || h.close || String(avgPrice));
          const currentVal = qty * ltp;
          const invested   = qty * avgPrice;
          const pnl        = parseFloat(h.profitandloss || String(currentVal - invested));
          const pnlPct     = invested > 0 ? (pnl / invested) * 100 : 0;
          const sym        = (h.tradingsymbol || 'UNKNOWN').replace('-EQ', '');
          return {
            symbol:       sym,
            qty,
            avgPrice:     parseFloat(avgPrice.toFixed(2)),
            ltp:          parseFloat(ltp.toFixed(2)),
            currentValue: parseFloat(currentVal.toFixed(2)),
            pnl:          parseFloat(pnl.toFixed(2)),
            pnlPct:       parseFloat(pnlPct.toFixed(2)),
            exchange:     h.exchange || 'NSE',
            isin:         h.isin || '',
          };
        }).filter(h => h.qty > 0);

        if (holdings.length > 0) {
          const totalValue = data.data?.totalholding?.totalholdingvalue
            ?? holdings.reduce((s, h) => s + h.currentValue, 0);
          const overallPnl = data.data?.totalholding?.totalpnl
            ?? holdings.reduce((s, h) => s + h.pnl, 0);

          const result = { holdings, totalValue, overallPnl };
          setCachedHoldings(result); // Cache for 2 minutes
          console.log(`[Portfolio] ✅ Fetched ${holdings.length} holding(s) from Angel One.`);
          return result;
        }
      }

      if (data?.errorCode === 'AG8002') {
        console.warn('[Portfolio] ⚠️ Rate limit hit (AG8002). Will serve from cache next call.');
      }
      if (data?.errorCode === 'AG8004') {
        console.error('[Portfolio] ❌ Invalid API Key (AG8004). Check smartapi.angelone.in portal.');
      }
    } catch (err: any) {
      console.warn(`[Portfolio] Holdings error @ ${endpoint}:`, err.message);
    }
  }

  return null;
}

// ── Fetch Available Funds ──────────────────────────────────────────────────────
async function fetchRealFunds(): Promise<number> {
  const token = await getJwtToken();
  if (!token) return 0;

  const headers = await getApiHeaders();
  try {
    const { data } = await axios.get(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getRMS',
      { headers, timeout: 5000 }
    );
    if (data?.data) {
      return parseFloat(data.data.net || data.data.availablecash || '0');
    }
  } catch {}
  return 0;
}

// ── Demo Data ──────────────────────────────────────────────────────────────────
const DEMO_RESPONSE = {
  connected: true,
  broker: 'Angel One (Demo)',
  totalValue: 333690,
  todayPnl: 3240,
  overallPnl: 10190,
  availableFunds: 125000,
  holdings: [
    { symbol: 'RELIANCE',  qty: 50,  avgPrice: 2820, ltp: 2880, pnl: 3000,  pnlPct: 4.25, currentValue: 144000 },
    { symbol: 'TCS',       qty: 20,  avgPrice: 3550, ltp: 3612, pnl: 1240,  pnlPct: 1.75, currentValue:  72240 },
    { symbol: 'CUPID',     qty: 250, avgPrice:  198, ltp:  215, pnl: 4350,  pnlPct: 8.78, currentValue:  53750 },
    { symbol: 'INFY',      qty: 40,  avgPrice: 1550, ltp: 1590, pnl: 1600,  pnlPct: 2.58, currentValue:  63600 },
  ],
  demoMode: true,
};

// ── GET /api/portfolio ─────────────────────────────────────────────────────────
portfolioRouter.get('/', async (_req: Request, res: Response) => {
  if (process.env.DEMO_MODE === 'true') return res.json(DEMO_RESPONSE);

  const token = await getJwtToken();
  if (!token) {
    const { lastError } = getSessionStatus();
    return res.json({
      connected: false, broker: null, totalValue: 0, todayPnl: 0,
      overallPnl: 0, availableFunds: 0, holdings: [], demoMode: false,
      error: lastError || 'Angel One authentication failed.',
    });
  }

  const [holdingsData, funds] = await Promise.all([fetchRealHoldings(), fetchRealFunds()]);

  return res.json({
    connected: true,
    broker: 'Angel One (SmartAPI Live)',
    totalValue:     holdingsData?.totalValue   ?? 0,
    todayPnl:       0,
    overallPnl:     holdingsData?.overallPnl   ?? 0,
    availableFunds: funds,
    holdings:       holdingsData?.holdings     ?? [],
    demoMode: false,
    error: holdingsData ? undefined : 'Could not fetch holdings. Will retry next call.',
  });
});

// ── POST /api/portfolio/connect ────────────────────────────────────────────────
portfolioRouter.post('/connect', async (req: Request, res: Response) => {
  const { broker = 'angelone' } = req.body ?? {};

  if (broker !== 'angelone') {
    return res.status(400).json({ success: false, error: `${broker} integration coming soon.` });
  }

  const token = await getJwtToken();
  if (!token) {
    const { lastError } = getSessionStatus();
    return res.status(400).json({ success: false, error: lastError || 'Login failed' });
  }

  const [holdingsData, funds] = await Promise.all([fetchRealHoldings(), fetchRealFunds()]);

  return res.json({
    success: true, connected: true, broker: 'Angel One (SmartAPI Live)',
    totalValue:     holdingsData?.totalValue   ?? 0,
    overallPnl:     holdingsData?.overallPnl   ?? 0,
    availableFunds: funds,
    holdings:       holdingsData?.holdings     ?? [],
    message: 'Successfully authenticated with Angel One SmartAPI!',
  });
});

// ── POST /api/portfolio/disconnect ─────────────────────────────────────────────
portfolioRouter.post('/disconnect', (_req: Request, res: Response) => {
  clearSession();
  res.json({ success: true, connected: false });
});
