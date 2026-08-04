import { Router, Request, Response } from 'express';
import {
  MICRO_SANDBOX,
  MACRO_SANDBOX,
  placeSandboxTrade,
  getSandboxSummary,
  resetSandbox,
} from '../services/dualSandboxEngine';
import { computeThresholds, TradeStrategy } from '../services/dynamicThresholdEngine';
import { LIVE_CONTEXT } from '../services/aiAgentService';

export const sandboxRouter = Router();

// ── GET /api/sandbox — Get both sandbox summaries ─────────────────────────────
sandboxRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    micro: getSandboxSummary(MICRO_SANDBOX),
    macro: getSandboxSummary(MACRO_SANDBOX),
    marketContext: {
      regime: LIVE_CONTEXT.regime,
      vix: LIVE_CONTEXT.vix,
    },
  });
});

// ── GET /api/sandbox/:id/trades — Get trade history for a sandbox ─────────────
sandboxRouter.get('/:id/trades', (req: Request, res: Response) => {
  const id = req.params.id.toUpperCase();
  const sandbox = id === 'MICRO' ? MICRO_SANDBOX : id === 'MACRO' ? MACRO_SANDBOX : null;
  if (!sandbox) return res.status(404).json({ error: 'Invalid sandbox ID. Use MICRO or MACRO.' });

  res.json({
    sandbox: sandbox.id,
    trades: [...sandbox.trades].reverse(), // newest first
    openPositions: sandbox.openPositions,
    summary: getSandboxSummary(sandbox),
  });
});

// ── POST /api/sandbox/:id/trade — Place a trade in a sandbox ──────────────────
sandboxRouter.post('/:id/trade', (req: Request, res: Response) => {
  const id = req.params.id.toUpperCase();
  const sandbox = id === 'MICRO' ? MICRO_SANDBOX : id === 'MACRO' ? MACRO_SANDBOX : null;
  if (!sandbox) return res.status(404).json({ error: 'Invalid sandbox ID. Use MICRO or MACRO.' });

  const { symbol, direction, qty, price, strategy = 'DELIVERY', confidence } = req.body ?? {};

  if (!symbol || !direction || !qty || !price) {
    return res.status(400).json({ error: 'symbol, direction, qty, price are required' });
  }

  const trade = placeSandboxTrade(
    sandbox,
    String(symbol).toUpperCase(),
    direction as 'BUY' | 'SELL',
    Number(qty),
    Number(price),
    (strategy as TradeStrategy) ?? 'DELIVERY',
    confidence ? Number(confidence) : undefined,
    LIVE_CONTEXT.vix,
    LIVE_CONTEXT.regime,
  );

  res.status(trade.status === 'REJECTED' ? 422 : 201).json({
    trade,
    sandboxSummary: getSandboxSummary(sandbox),
  });
});

// ── POST /api/sandbox/:id/reset — Reset a sandbox to initial state ────────────
sandboxRouter.post('/:id/reset', (req: Request, res: Response) => {
  const id = req.params.id.toUpperCase();
  const sandbox = id === 'MICRO' ? MICRO_SANDBOX : id === 'MACRO' ? MACRO_SANDBOX : null;
  if (!sandbox) return res.status(404).json({ error: 'Invalid sandbox ID. Use MICRO or MACRO.' });

  resetSandbox(sandbox);
  res.json({ reset: true, sandbox: getSandboxSummary(sandbox) });
});

// ── GET /api/sandbox/threshold — Compute dynamic threshold for a trade ─────────
sandboxRouter.post('/threshold', (req: Request, res: Response) => {
  const { capital, strategy = 'DELIVERY', stockPrice = 100 } = req.body ?? {};
  if (!capital) return res.status(400).json({ error: 'capital is required' });

  const result = computeThresholds(
    Number(capital),
    (strategy as TradeStrategy) ?? 'DELIVERY',
    Number(stockPrice),
    LIVE_CONTEXT.vix,
    LIVE_CONTEXT.regime,
  );

  res.json(result);
});
