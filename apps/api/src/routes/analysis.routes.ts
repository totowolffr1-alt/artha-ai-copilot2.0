import { Router, Request, Response } from 'express';
import { calculateConfidence } from '../services/confidenceEngine';
import { buildExplanation } from '../services/explanationBuilder';
import { confidenceHistory } from '../services/confidenceHistory';
import { latestTicks } from './market.routes';

export const analysisRouter = Router();

analysisRouter.get('/confidence', async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'RELIANCE').toUpperCase().trim();
  try {
    const report = await calculateConfidence(symbol);
    const explanation = buildExplanation(report);

    // Evaluate past signals first using latest prices
    const prices: Record<string, number> = {};
    latestTicks.forEach((tick, sym) => {
      prices[sym.toUpperCase()] = tick.price;
    });
    confidenceHistory.evaluateOutcomes(prices);

    // Log this signal in database/history file if it has a directional conviction
    if (report.direction !== 'NEUTRAL') {
      confidenceHistory.log({
        symbol: report.symbol,
        direction: report.direction,
        confidence: report.confidence,
        priceAtSignal: report.price,
      });
    }

    res.json({ report, explanation });
  } catch (err: any) {
    console.error(`[Analysis] Error calculating confidence for ${symbol}:`, err.message);
    res.status(502).json({ error: `Analysis failed: ${err.message}` });
  }
});

analysisRouter.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = confidenceHistory.getStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

analysisRouter.post('/evaluate', (_req: Request, res: Response) => {
  try {
    const prices: Record<string, number> = {};
    latestTicks.forEach((tick, sym) => {
      prices[sym.toUpperCase()] = tick.price;
    });
    confidenceHistory.evaluateOutcomes(prices);
    res.json({ success: true, stats: confidenceHistory.getStats() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
