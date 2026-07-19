import { Router, Request, Response } from 'express';

export const portfolioRouter = Router();

// Phase 8 (Portfolio Management) has no implementation in the project yet.
// Returning realistic mock data so the frontend Portfolio page is buildable.

portfolioRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    stub: true,
    totalValue: 1245000,
    dayChange: 1.8,
    holdings: [
      { symbol: 'RELIANCE', qty: 50, avgPrice: 2820, ltp: 2950 },
      { symbol: 'TCS', qty: 20, avgPrice: 3700, ltp: 3850 },
      { symbol: 'INFY', qty: 40, avgPrice: 1600, ltp: 1650 },
    ],
  });
});
