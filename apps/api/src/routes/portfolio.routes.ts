/**
 * portfolio.routes.ts
 * Real data ONLY from Angel One SmartAPI.
 * No demo data, no fake fallbacks — honest empty states when broker is unavailable.
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
          setCachedHoldings(result);
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

// ── GET /api/portfolio ─────────────────────────────────────────────────────────
portfolioRouter.get('/', async (_req: Request, res: Response) => {
  const token = await getJwtToken();
  if (!token) {
    const { lastError } = getSessionStatus();
    return res.json({
      connected: false,
      broker: null,
      totalValue: 0,
      todayPnl: 0,
      overallPnl: 0,
      availableFunds: 0,
      holdings: [],
      error: lastError || 'Angel One not connected. Check credentials in server environment.',
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
    error: holdingsData ? undefined : 'Holdings fetch failed — whitelist server IP in Angel One portal.',
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

// ── GET /api/portfolio/positions (Intraday / F&O) ─────────────────────────────
portfolioRouter.get('/positions', async (_req: Request, res: Response) => {
  const token = await getJwtToken();

  if (!token) {
    return res.json({
      positions: [],
      unrealizedPnl: 0,
      isMarketCloseSoon: false,
      error: 'Angel One not connected.',
    });
  }

  const headers = await getApiHeaders();
  try {
    const { data } = await axios.get(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getPosition',
      { headers, timeout: 8000 }
    );
    if (data?.status === true && Array.isArray(data?.data)) {
      const positions = data.data
        .map((p: any) => ({
          symbol:        p.tradingsymbol || p.symbolname || 'UNKNOWN',
          product:       p.producttype || 'INTRADAY',
          qty:           Math.abs(parseInt(p.netqty || p.buyqty || '0', 10)),
          avgPrice:      parseFloat(p.avgnetprice || p.buyprice || '0'),
          ltp:           parseFloat(p.ltp || '0'),
          unrealizedPnl: parseFloat(p.unrealised || p.pnl || '0'),
          side:          parseInt(p.netqty || '0', 10) >= 0 ? 'BUY' : 'SELL',
          exchange:      p.exchange || 'NSE',
        }))
        .filter((p: any) => p.qty > 0);

      const unrealizedPnl = positions.reduce((s: number, p: any) => s + p.unrealizedPnl, 0);
      const now = new Date();
      const isMarketCloseSoon = now.getHours() === 15 && now.getMinutes() >= 30;
      return res.json({ positions, unrealizedPnl, isMarketCloseSoon });
    }

    // Angel One returned a non-success (e.g. IP not whitelisted, session error)
    const errorMsg = data?.message || data?.errorMessage || 'Position fetch failed';
    return res.json({
      positions: [],
      unrealizedPnl: 0,
      isMarketCloseSoon: false,
      error: errorMsg,
    });
  } catch (err: any) {
    return res.json({
      positions: [],
      unrealizedPnl: 0,
      isMarketCloseSoon: false,
      error: `Network error: ${err.message}`,
    });
  }
});

// ── In-memory paper trade store ───────────────────────────────────────────────
// Starts empty. Populated only when copilot actually executes paper trades.
export const paperTrades: any[] = [];

// ── GET /api/portfolio/paper ──────────────────────────────────────────────────
portfolioRouter.get('/paper', (_req: Request, res: Response) => {
  const closed  = paperTrades.filter(t => t.status === 'CLOSED');
  const wins    = closed.filter(t => t.netPnl > 0).length;
  const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0;
  const totalPnL = paperTrades.reduce((s, t) => s + (t.netPnl || 0), 0);
  const avgR = closed.length > 0
    ? parseFloat((closed.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / closed.length).toFixed(2))
    : 0;

  res.json({
    trades: paperTrades,
    summary: {
      winRate,
      totalPnL:    parseFloat(totalPnL.toFixed(2)),
      totalTrades: paperTrades.length,
      avgRMultiple: avgR,
    },
  });
});
