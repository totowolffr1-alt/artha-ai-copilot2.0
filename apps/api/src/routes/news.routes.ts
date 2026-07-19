import { Router, Request, Response } from 'express';

export const newsRouter = Router();

newsRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    stub: true,
    items: [
      { headline: 'News Intelligence (Phase 10) not implemented yet.', source: 'system', sentiment: 'neutral' },
    ],
  });
});
