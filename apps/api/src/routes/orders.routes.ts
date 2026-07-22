/**
 * orders.routes.ts — Phase 19: Autonomous Trading Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * REST endpoints for Order Execution management, pending approvals, and kill switch.
 */

import { Router, Request, Response } from 'express';
import { getPendingApprovals, resolveApproval, emergencyKillSwitch } from '../services/orderExecutionService';
import { TradeJournalService } from '../services/tradeJournalService';

export const ordersRouter = Router();

// GET /api/orders/pending — list all trades currently awaiting human approval
ordersRouter.get('/pending', (_req: Request, res: Response) => {
  const pending = getPendingApprovals();
  res.json({ pendingCount: pending.length, pending });
});

// POST /api/orders/approve — approve or reject a pending trade
ordersRouter.post('/approve', (req: Request, res: Response) => {
  const { signalId, approved } = req.body ?? {};
  if (!signalId || typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'signalId (string) and approved (boolean) are required' });
  }

  const ok = resolveApproval(signalId, approved);
  if (!ok) {
    return res.status(404).json({ error: 'Pending order not found or already expired' });
  }

  return res.json({ message: `Order ${signalId} ${approved ? 'APPROVED' : 'REJECTED'}` });
});

// GET /api/orders/open — list all open trades in trade journal
ordersRouter.get('/open', async (_req: Request, res: Response) => {
  const openTrades = await TradeJournalService.getOpenTrades();
  res.json({ openCount: openTrades.length, trades: openTrades });
});

// GET /api/orders/history — list recently closed trades
ordersRouter.get('/history', async (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const history = await TradeJournalService.getTradeHistory(limit);
  res.json({ count: history.length, trades: history });
});

// POST /api/orders/killswitch — emergency kill switch
ordersRouter.post('/killswitch', (_req: Request, res: Response) => {
  emergencyKillSwitch();
  res.json({ message: 'Emergency Kill Switch triggered. Trading halted and vault locked.' });
});
