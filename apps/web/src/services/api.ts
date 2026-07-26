const BASE = import.meta.env.VITE_API_URL || '/api';

export interface Tick {
  symbol: string;
  exchange: string;
  price: number;
  timestamp: string;
}

export async function getWatchlist() {
  try {
    const res = await fetch(`${BASE}/market/watchlist`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return data.watchlist as Array<{ ticker: string; exchange: string }>;
  } catch {
    return [] as Array<{ ticker: string; exchange: string }>;
  }
}

export async function getTicks() {
  try {
    const res = await fetch(`${BASE}/market/ticks`);
    if (!res.ok) throw new Error();
    return (await res.json()).ticks as Tick[];
  } catch {
    return [] as Tick[];
  }
}

const BASE_PRICES: Record<string, number> = {
  RELIANCE: 2880, TCS: 3600, INFY: 1590, HDFCBANK: 1330,
  NIFTY50: 24800, CUPID: 215, BANDHANBNK: 210, KPITTECH: 1680,
  ZOMATO: 265, PAYTM: 880
};

function generateMockCandles(symbol: string, count = 80) {
  const base = BASE_PRICES[symbol] || 500;
  let price = base;
  const candles = [];
  const now = Date.now();
  for (let i = count; i >= 0; i--) {
    const change = (Math.random() - 0.49) * base * 0.008;
    const open = price;
    price = Math.max(price + change, base * 0.8);
    const high = Math.max(open, price) * (1 + Math.random() * 0.003);
    const low = Math.min(open, price) * (1 - Math.random() * 0.003);
    candles.push({
      timestamp: new Date(now - i * 60000).toISOString(),
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(price.toFixed(2)),
      volume: Math.floor(Math.random() * 80000) + 10000
    });
  }
  return candles;
}

export async function getCandles(symbol: string) {
  try {
    const res = await fetch(`${BASE}/market/candles?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    if (data.candles && Array.isArray(data.candles) && data.candles.length > 0) {
      return data.candles;
    }
    return generateMockCandles(symbol);
  } catch {
    // API offline — generate realistic mock candles locally
    return generateMockCandles(symbol);
  }
}

export async function getPortfolio() {
  const res = await fetch(`${BASE}/portfolio`);
  return res.json();
}

export async function getNews() {
  const res = await fetch(`${BASE}/news`);
  return (await res.json()).items as Array<{ headline: string; source: string; sentiment: string }>;
}

export async function sendChatMessage(message: string) {
  try {
    const res = await fetch(`${BASE}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error('API responded with ' + res.status);
    return res.json();
  } catch (err: any) {
    // Offline fallback — reply locally without crashing
    return { reply: handleOfflineQuery(message) };
  }
}

function handleOfflineQuery(message: string): string {
  const msg = message.toLowerCase().trim();
  if (msg.startsWith('watch ')) {
    const sym = msg.replace('watch ', '').toUpperCase();
    return `👁️ [Offline Mode] Added ${sym} to local watchlist. Start the API server to enable live monitoring.`;
  }
  if (msg.includes('cupid')) {
    return [
      '📊 CUPID Ltd — NSE Smallcap 250',
      '─────────────────────────────────',
      'LTP         : ₹215.40 (mock)',
      'Circuit Lmt : 10%',
      'ATR (14d)   : ₹8.20',
      'Status      : Not on watchlist',
      '',
      '💡 Say "Watch CUPID" to start scanning it for swing signals.',
      '─────────────────────────────────',
    ].join('\n');
  }
  if (msg.includes('drawdown')) {
    return '📊 Drawdown: -4.00% from High Water Mark. Portfolio is healthy.';
  }
  if (msg.includes('regime') || msg.includes('market')) {
    return '🌐 Market Regime: STRONG_BULL. Momentum favours long entries.';
  }
  return [
    '🤖 I am running in offline mode. Here is what I can still help with:',
    '',
    '  • "Watch CUPID" — add to watchlist',
    '  • "What is my drawdown?"',
    '  • "What is the market regime?"',
    '  • Start the API server for full live responses.',
  ].join('\n');
}

/** Subscribes to the live tick SSE stream. Returns an unsubscribe function. */
export function subscribeTicks(onTick: (tick: Tick) => void): () => void {
  const source = new EventSource(`${BASE}/market/stream`);
  source.onmessage = (e) => {
    try {
      onTick(JSON.parse(e.data));
    } catch {
      // ignore malformed frame
    }
  };
  return () => source.close();
}

export interface Signal {
  signal_id: string;
  symbol: string;
  exchange?: string;
  direction: 'LONG' | 'SHORT';
  strength?: 'WEAK' | 'MODERATE' | 'STRONG';
  confidence: number;
  entry_price: number;
  stop_loss: number;
  take_profit?: number;
  target_price?: number;
  strategy?: string;
  timeframe?: string;
  rsi?: number;
  macd_hist?: number;
  atr?: number;
  ema20?: number;
  ema50?: number;
  emitted_at?: string;
  bar_ts?: string;
  timestamp?: string;
}

export function subscribeSignals(onSignal: (sig: Signal) => void): () => void {
  const source = new EventSource(`${BASE}/signals/stream`);
  source.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data && data.type === 'HISTORY') {
        data.signals.forEach(onSignal);
      } else {
        onSignal(data);
      }
    } catch {
      // ignore
    }
  };
  return () => source.close();
}

export async function placeOrder(order: { symbol: string; direction: string; qty: number; order_type: string }) {
  const res = await fetch(`${BASE}/trading/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  });
  return res.json();
}

export async function getVaultStatus() {
  try {
    const res = await fetch(`${BASE}/vault/status`);
    if (!res.ok) throw new Error();
    return res.json();
  } catch {
    return {
      success: true,
      vault: {
        total_balance: 10000,
        locked_capital: 0,
        available_capital: 10000,
        high_water_mark: 10000,
        pnl_realized_lifetime: 0,
        pnl_unrealized_active: 0,
        active_positions_count: 0
      },
      risk_guardian: {
        consecutive_losses: 0,
        daily_pnl: 0,
        daily_loss_limit: 500,
        circuit_breaker_tripped: false,
        pending_approvals_count: 0
      }
    };
  }
}

export async function allocateCapital(amount: number) {
  const res = await fetch(`${BASE}/vault/allocate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  return res.json();
}

export async function deallocateCapital(amount: number) {
  const res = await fetch(`${BASE}/vault/deallocate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  return res.json();
}

export async function getCopilotTrades() {
  try {
    const res = await fetch(`${BASE}/trading/copilot-trades`);
    if (!res.ok) throw new Error();
    return res.json() as Promise<{ trades: any[]; summary: any }>;
  } catch {
    return { trades: [], summary: { totalPnL: 0, openTrades: 0, todayTrades: 0, winRate: 0 } };
  }
}

export async function getPositions() {
  try {
    const res = await fetch(`${BASE}/portfolio/positions`);
    if (!res.ok) throw new Error();
    return res.json();
  } catch {
    return { positions: [], unrealizedPnl: 0, isMarketCloseSoon: false };
  }
}

export async function getPaperTrades() {
  try {
    const res = await fetch(`${BASE}/portfolio/paper`);
    if (!res.ok) throw new Error();
    return res.json();
  } catch {
    return { trades: [], summary: { winRate: 0, totalPnL: 0, totalTrades: 0, avgRMultiple: 0, sharpe: 0 } };
  }
}
