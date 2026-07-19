import { Router, Request, Response } from 'express';

export const aiRouter = Router();

// Simulated Phase 10 Conversation Context & QueryHandler for high-fidelity frontend
const WATCHLIST = new Set<string>(['RELIANCE', 'TCS', 'INFY']);
const POSITIONS = [
  { symbol: 'BANKNIFTY', direction: 'SHORT', qty: 15, entryPrice: 47200, ltp: 47050, pnl: 2250 },
];
const drawdown = -0.04;
const regime = 'STRONG_BULL';

function handleQuery(message: string): string {
  const msg = message.toLowerCase().trim();

  if (msg.includes('why') && (msg.includes('reject') || msg.includes('suppress') || msg.includes('block'))) {
    return [
      `🔍 Signal Audit — TCS`,
      `─────────────────────────────────────────────`,
      `Status    : REJECTED`,
      `Regime    : STRONG_BULL`,
      `Confidence: 74.5%`,
      `Reason    : Position size would exceed single-trade exposure limit of 5% (Stage 1 validation failed).`,
      `Time      : ${new Date().toLocaleTimeString('en-IN')}`,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  if (msg.includes('drawdown') || (msg.includes('loss') && msg.includes('max'))) {
    return [
      `📊 Portfolio Drawdown`,
      `─────────────────────────────────────────────`,
      `Current Drawdown : ${(drawdown * 100).toFixed(2)}% from HWM`,
      `Portfolio Value  : ₹12,45,000.00`,
      `High Water Mark  : ₹12,96,875.00`,
      `Assessment       : ✅ Healthy — within normal range.`,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  if (msg.includes('position') || msg.includes('open trade')) {
    const lines = POSITIONS.map(p => 
      `  • ${p.symbol} ${p.direction} | Qty: ${p.qty} | Entry: ₹${p.entryPrice} | LTP: ₹${p.ltp} | P&L: +₹${p.pnl}`
    );
    return [
      `📋 Open Positions (${POSITIONS.length})`,
      `─────────────────────────────────────────────`,
      ...lines,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  if (msg.includes('watchlist')) {
    const lines = Array.from(WATCHLIST).map(s => `  • ${s} (threshold: 55%)`);
    return [
      `👁️ Watchlist (${WATCHLIST.size} symbols)`,
      `─────────────────────────────────────────────`,
      ...lines,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  // Handle "watch SYMBOL" command for any stock
  if (msg.startsWith('watch ')) {
    const symbol = msg.replace('watch ', '').toUpperCase().trim();
    WATCHLIST.add(symbol);
    return [
      `👁️ Now watching ${symbol}`,
      `─────────────────────────────────────────────`,
      `Symbol     : ${symbol}`,
      `Exchange   : NSE`,
      `Mode       : ${process.env.TRADING_MODE || 'SWING'} (${process.env.TRADING_MODE === 'INTRADAY' ? 'MIS' : 'CNC'})`,
      `Status     : Signal Engine is warming up indicators (needs 50 candles)…`,
      `Threshold  : 55% confidence minimum`,
      `Action     : I will alert you the moment a high-quality setup emerges!`,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  // Handle generic stock query - any capitalised ticker pattern or stock name
  const stockMatch = msg.match(/\b([a-z]{2,10})\b/g);
  const potentialSymbol = stockMatch?.find(w =>
    w.length >= 2 && w !== 'why' && w !== 'what' && w !== 'show' && w !== 'the' && w !== 'is'
  )?.toUpperCase();

  if (potentialSymbol && !msg.includes('position') && !msg.includes('watchlist') && !msg.includes('drawdown') && !msg.includes('regime')) {
    const isWatched = WATCHLIST.has(potentialSymbol);
    return [
      `📊 ${potentialSymbol} — NSE Smallcap`,
      `─────────────────────────────────────────────`,
      `Watchlist  : ${isWatched ? '✅ Currently being monitored' : '❌ Not on watchlist'}`,
      `Mode       : ${process.env.TRADING_MODE || 'SWING'}`,
      ``,
      isWatched
        ? `Signal Engine is actively scanning ${potentialSymbol} for RSI/MACD crossover entries.`
        : `I am not monitoring ${potentialSymbol} yet. Say "Watch ${potentialSymbol}" to start scanning it for ${process.env.TRADING_MODE === 'INTRADAY' ? 'intraday' : 'swing'} signals.`,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  return [
    `🤖 I didn't quite understand that. Here's what I can help with:`,
    ``,
    `  • "Why was TCS rejected?"`,
    `  • "What is my drawdown?"`,
    `  • "Show open positions"`,
    `  • "Today's summary"`,
    `  • "What is the market regime?"`,
    `  • "Watch CUPID" / "Watch RELIANCE"`,
    `  • "Show watchlist"`,
  ].join('\n');
}

aiRouter.post('/chat', (req: Request, res: Response) => {
  const { message } = req.body ?? {};
  res.json({
    reply: handleQuery(message ?? ''),
  });
});

aiRouter.get('/daily-briefing', (_req: Request, res: Response) => {
  res.json({
    regime,
    vix_level: 14.5,
    portfolio_heat: 0.28,
    open_positions: POSITIONS.length,
    yesterday_pnl: 1840,
    week_wins: 6,
    week_losses: 2,
    high_conf_setups: [
      { symbol: 'RELIANCE', direction: 'LONG', score: 82 },
      { symbol: 'TCS', direction: 'LONG', score: 76 }
    ],
    kill_switch_active: false
  });
});
