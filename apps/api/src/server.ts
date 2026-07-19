import express from 'express';
import cors from 'cors';
import { SimpleEventBus } from '../../../packages/phase2-market-data/src/marketData/SimpleEventBus';
import { MockMarketDataAdapter } from '../../../packages/phase2-market-data/src/marketData/adapters/mock/MockAdapter';
import { marketRouter, attachMarketData } from './routes/market.routes';
import { aiRouter } from './routes/ai.routes';
import { portfolioRouter } from './routes/portfolio.routes';
import { tradingRouter } from './routes/trading.routes';
import { newsRouter } from './routes/news.routes';
import { signalsRouter } from './routes/signals.routes';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ─── Market data wiring (Phase 2 real code + Mock adapter for local dev) ──
  const bus = new SimpleEventBus();
  const adapter = new MockMarketDataAdapter(bus);
  await adapter.connect();

  attachMarketData(bus, adapter);

  app.use('/api/market', marketRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/trading', tradingRouter);
  app.use('/api/news', newsRouter);
  app.use('/api/signals', signalsRouter);

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      marketDataAdapter: adapter.name,
      isLive: adapter.isLive,
      connected: adapter.isConnected(),
    });
  });

  app.listen(PORT, () => {
    console.log(`Artha API listening on http://localhost:${PORT}`);
    console.log(`Market data adapter: ${adapter.name} (isLive=${adapter.isLive})`);
  });
}

main().catch(err => {
  console.error('Failed to start API server:', err);
  process.exit(1);
});
