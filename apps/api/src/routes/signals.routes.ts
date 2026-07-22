/**
 * signals.routes.ts
 *
 * Modified to support Phase 12 real price streaming.
 * Uses SignalEngine and exposes SSE streaming of real-time signals.
 * Simulated tick intervals are removed, replaced by ticks from liveMarketService.
 */

import { Router, Request, Response } from 'express';
import { SignalEngine } from '../../../../packages/phase5-strategy/src/signals/SignalEngine';
import { liveSignalsHistory, sseClients } from '../services/liveMarketService';

export const signalsRouter = Router();

// Instantiate and export SignalEngine so other services can access it
export const signalEngine = new SignalEngine();

// SSE Stream Endpoint for real-time signals
signalsRouter.get('/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send historical signals to client on connect
  res.write(`data: ${JSON.stringify({ type: 'HISTORY', signals: liveSignalsHistory })}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
    res.end();
  });
});

// GET /api/signals/history
signalsRouter.get('/history', (_req: Request, res: Response) => {
  res.json({ signals: liveSignalsHistory });
});
