import { Router, Request, Response } from 'express';
import { SignalEngine } from '../../../../packages/phase5-strategy/src/signals/SignalEngine';

export const signalsRouter = Router();

// Instantiate SignalEngine
const signalEngine = new SignalEngine();

// Warm up the engine with a background interval to simulate ticks
// (This guarantees the frontend has real-looking signals flowing even on local hosts!)
const symbols = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK'];
const basePrices: Record<string, number> = { RELIANCE: 2880, TCS: 3600, INFY: 1590, HDFCBANK: 1330 };
const latestPrices = { ...basePrices };

const signalHistory: any[] = [];
const clients = new Set<Response>();

// Aggregated 1m bar trackers
const highTracker: Record<string, number> = {};
const lowTracker: Record<string, number> = {};
const openTracker: Record<string, number> = {};

// Simulate live price ticks every 500ms
setInterval(() => {
  symbols.forEach(sym => {
    const changePct = (Math.random() - 0.5) * 0.005; // -0.25% to +0.25%
    const oldPrice = latestPrices[sym];
    const newPrice = oldPrice * (1 + changePct);
    latestPrices[sym] = newPrice;

    // Track OHLC bars
    if (!openTracker[sym]) openTracker[sym] = oldPrice;
    highTracker[sym] = Math.max(highTracker[sym] || newPrice, newPrice);
    lowTracker[sym] = Math.min(lowTracker[sym] || newPrice, newPrice);
  });
}, 500);

// Emit bar events every 15 seconds to accelerate warmup and signal generation
setInterval(() => {
  symbols.forEach(sym => {
    const open = openTracker[sym] || latestPrices[sym];
    const high = highTracker[sym] || latestPrices[sym];
    const low = lowTracker[sym] || latestPrices[sym];
    const close = latestPrices[sym];
    const volume = Math.floor(Math.random() * 50000) + 10000;

    // Reset bar trackers
    openTracker[sym] = close;
    highTracker[sym] = close;
    lowTracker[sym] = close;

    const signal = signalEngine.processBar(sym, open, high, low, close, volume);
    if (signal) {
      signalHistory.push(signal);
      if (signalHistory.length > 50) signalHistory.shift();

      // Dispatch to all connected SSE clients
      clients.forEach(res => {
        res.write(`data: ${JSON.stringify(signal)}\n\n`);
      });
    }
  });
}, 15000);

// SSE Stream Endpoint
signalsRouter.get('/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send historical signals to client on connect
  res.write(`data: ${JSON.stringify({ type: 'HISTORY', signals: signalHistory })}\n\n`);

  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
    res.end();
  });
});

signalsRouter.get('/history', (_req: Request, res: Response) => {
  res.json({ signals: signalHistory });
});
