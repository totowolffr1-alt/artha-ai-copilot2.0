import { Router, Request, Response } from 'express';

export const watchlistRouter = Router();

// ── In-memory store (localStorage is primary; this enables cross-tab sync) ───
interface WatchlistStock {
  symbol: string;
  exchange: string;
  pinned?: boolean;
  addedAt: string;
}

interface Watchlist {
  id: string;
  name: string;
  stocks: WatchlistStock[];
  createdAt: string;
}

const store: Watchlist[] = [
  {
    id: 'default',
    name: 'My Watchlist',
    createdAt: new Date().toISOString(),
    stocks: [
      { symbol: 'RELIANCE', exchange: 'NSE', pinned: false, addedAt: new Date().toISOString() },
      { symbol: 'TCS', exchange: 'NSE', pinned: false, addedAt: new Date().toISOString() },
      { symbol: 'CUPID', exchange: 'NSE', pinned: true, addedAt: new Date().toISOString() },
      { symbol: 'ZOMATO', exchange: 'NSE', pinned: false, addedAt: new Date().toISOString() },
    ],
  },
];

export function getWatchlistSymbols(): string[] {
  const wl = store.find(w => w.id === 'default');
  return wl ? wl.stocks.map(s => s.symbol) : [];
}

// GET all watchlists
watchlistRouter.get('/', (_req: Request, res: Response) => {
  res.json({ watchlists: store });
});

// POST create new watchlist
watchlistRouter.post('/', (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const wl: Watchlist = {
    id: Date.now().toString(),
    name,
    stocks: [],
    createdAt: new Date().toISOString(),
  };
  store.push(wl);
  res.json({ watchlist: wl });
});

// PUT rename watchlist
watchlistRouter.put('/:id', (req: Request, res: Response) => {
  const wl = store.find(w => w.id === req.params.id);
  if (!wl) return res.status(404).json({ error: 'not found' });
  wl.name = req.body.name || wl.name;
  res.json({ watchlist: wl });
});

// DELETE watchlist
watchlistRouter.delete('/:id', (req: Request, res: Response) => {
  const idx = store.findIndex(w => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  store.splice(idx, 1);
  res.json({ ok: true });
});

// POST add stock to watchlist
watchlistRouter.post('/:id/stocks', (req: Request, res: Response) => {
  const wl = store.find(w => w.id === req.params.id);
  if (!wl) return res.status(404).json({ error: 'watchlist not found' });
  const { symbol, exchange = 'NSE' } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  if (wl.stocks.find(s => s.symbol === symbol)) {
    return res.json({ ok: true, message: 'already in watchlist' });
  }
  wl.stocks.push({ symbol, exchange, pinned: false, addedAt: new Date().toISOString() });
  res.json({ ok: true, watchlist: wl });
});

// DELETE remove stock from watchlist
watchlistRouter.delete('/:id/stocks/:symbol', (req: Request, res: Response) => {
  const wl = store.find(w => w.id === req.params.id);
  if (!wl) return res.status(404).json({ error: 'watchlist not found' });
  wl.stocks = wl.stocks.filter(s => s.symbol !== req.params.symbol);
  res.json({ ok: true, watchlist: wl });
});

// PUT pin/unpin stock
watchlistRouter.put('/:id/stocks/:symbol/pin', (req: Request, res: Response) => {
  const wl = store.find(w => w.id === req.params.id);
  if (!wl) return res.status(404).json({ error: 'not found' });
  const stock = wl.stocks.find(s => s.symbol === req.params.symbol);
  if (stock) stock.pinned = !stock.pinned;
  res.json({ ok: true, pinned: stock?.pinned });
});
