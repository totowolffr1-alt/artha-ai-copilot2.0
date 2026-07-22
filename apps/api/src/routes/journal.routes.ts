/**
 * apps/api/src/routes/journal.routes.ts
 * Artha AI — Trade Journal & Performance Analytics API Router
 */

import { Router, Request, Response } from 'express';
import { TradeJournalService } from '../services/tradeJournalService';

export const journalRouter = Router();

// GET /api/journal — Returns all trade entries (optional query: status=OPEN|CLOSED, limit=50)
journalRouter.get('/', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const status = req.query.status as 'OPEN' | 'CLOSED' | undefined;
    const journal = TradeJournalService.getJournal(limit, status);
    res.json({ success: true, count: journal.length, journal });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/journal/metrics — Returns quantitative risk & performance metrics (Sharpe, Sortino, Win Rate, Drawdown)
journalRouter.get('/metrics', (req: Request, res: Response) => {
  try {
    const initialCapital = req.query.capital ? Number(req.query.capital) : 1_000_000;
    const metrics = TradeJournalService.getPerformanceMetrics(initialCapital);
    res.json({ success: true, metrics });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/journal/entry — Records a trade entry
journalRouter.post('/entry', (req: Request, res: Response) => {
  try {
    const { symbol, direction, entry_price, quantity, stop_loss, take_profit, segment, regime } = req.body;

    if (!symbol || !direction || !entry_price || !quantity || !stop_loss || !take_profit) {
      return res.status(400).json({
        success: false,
        error: 'Missing required trade parameters (symbol, direction, entry_price, quantity, stop_loss, take_profit)',
      });
    }

    const record = TradeJournalService.recordEntry({
      symbol,
      direction,
      entry_price: Number(entry_price),
      quantity: Number(quantity),
      stop_loss: Number(stop_loss),
      take_profit: Number(take_profit),
      segment,
      regime,
    });

    res.status(201).json({ success: true, record });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/journal/exit — Records a trade exit and calculates fees + net P&L
journalRouter.post('/exit', (req: Request, res: Response) => {
  try {
    const { trade_id, exit_price, exit_reason } = req.body;

    if (!trade_id || !exit_price) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: trade_id and exit_price',
      });
    }

    const updated = TradeJournalService.recordExit(
      trade_id,
      Number(exit_price),
      exit_reason || 'MANUAL'
    );

    if (!updated) {
      return res.status(404).json({ success: false, error: `Trade ${trade_id} not found or already closed` });
    }

    res.json({ success: true, record: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
