import { Router, Request, Response } from 'express';
import type { IEventBus } from '../../../../packages/phase2-market-data/src/marketData/EventBus';
import type { MockMarketDataAdapter } from '../../../../packages/phase2-market-data/src/marketData/adapters/mock/MockAdapter';

export const marketRouter = Router();

const WATCHLIST = [
  { ticker: 'RELIANCE', exchange: 'NSE' },
  { ticker: 'TCS', exchange: 'NSE' },
  { ticker: 'INFY', exchange: 'NSE' },
  { ticker: 'HDFCBANK', exchange: 'NSE' },
  { ticker: 'NIFTY50', exchange: 'NSE' },
];

let sharedBus: IEventBus | null = null;
let sharedAdapter: MockMarketDataAdapter | null = null;
const latestTicks = new Map<string, { symbol: string; exchange: string; price: number; timestamp: string }>();

/** Wires the API layer to the live EventBus + adapter created in server.ts */
export function attachMarketData(bus: IEventBus, adapter: MockMarketDataAdapter) {
  sharedBus = bus;
  sharedAdapter = adapter;

  bus.on('TICK_RECEIVED', (event: any) => {
    const tick = event.tick;
    latestTicks.set(tick.symbol, tick);
  });
}

marketRouter.get('/watchlist', (_req: Request, res: Response) => {
  res.json({ watchlist: WATCHLIST });
});

marketRouter.get('/ticks', (_req: Request, res: Response) => {
  res.json({ ticks: Array.from(latestTicks.values()) });
});

marketRouter.get('/candles', async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol ?? 'RELIANCE');
  if (!sharedAdapter) return res.status(503).json({ error: 'market data adapter not ready' });

  const tokenResult = await sharedAdapter.resolveToken(symbol, 'NSE');
  if (!tokenResult.ok) return res.status(404).json({ error: 'unknown symbol' });

  const candlesResult = await sharedAdapter.fetchRawCandles(tokenResult.value, '1minute', '', '');
  if (!candlesResult.ok) return res.status(500).json({ error: 'failed to fetch candles' });

  res.json({ symbol, candles: candlesResult.value });
});

/** Server-Sent Events stream of live ticks for the frontend dashboard */
marketRouter.get('/stream', (req: Request, res: Response) => {
  if (!sharedBus) return res.status(503).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const unsubscribe = sharedBus.on('TICK_RECEIVED', (event: any) => {
    res.write(`data: ${JSON.stringify(event.tick)}\n\n`);
  });

  req.on('close', () => {
    unsubscribe();
    res.end();
  });
});
