import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env using multiple fallback paths to support both dev (ts-node) and production (dist) modes
dotenv.config({ path: path.resolve(__dirname, '../../../.env') }); // dev mode: apps/api/src -> root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') }); // prod mode: dist/apps/api/src -> root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });


import { SimpleEventBus } from '../../../packages/phase2-market-data/src/marketData/SimpleEventBus';
import { MockMarketDataAdapter } from '../../../packages/phase2-market-data/src/marketData/adapters/mock/MockAdapter';
import { marketRouter, attachMarketData } from './routes/market.routes';
import { aiRouter } from './routes/ai.routes';
import { portfolioRouter } from './routes/portfolio.routes';
import { tradingRouter } from './routes/trading.routes';
import { newsRouter } from './routes/news.routes';
import { signalsRouter } from './routes/signals.routes';
import { watchlistRouter } from './routes/watchlist.routes';
import { analysisRouter } from './routes/analysis.routes';

// Shared broker session — single login for entire server lifecycle
import { getJwtToken } from './services/brokerSession';
import { systemRouter } from './routes/system.routes';
import { journalRouter } from './routes/journal.routes';
import { vaultRouter } from './routes/vault.routes';
import { ordersRouter } from './routes/orders.routes';
import { agentRouter } from './routes/agent.routes';
import { sandboxRouter } from './routes/sandbox.routes';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ─── Market data wiring (Phase 12 Real Price Feed / WebSocket) ─────────────
  const bus = new SimpleEventBus();
  const { initLiveMarketFeed } = await import('./services/liveMarketService');
  const { signalEngine } = await import('./routes/signals.routes');
  const adapter = await initLiveMarketFeed(bus, signalEngine);
  attachMarketData(bus, adapter);

  // ─── Routes ────────────────────────────────────────────────────────────────
  app.use('/api/market',    marketRouter);
  app.use('/api/ai',        aiRouter);
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/trading',   tradingRouter);
  app.use('/api/news',      newsRouter);
  app.use('/api/signals',   signalsRouter);
  app.use('/api/watchlist', watchlistRouter);
  app.use('/api/system',    systemRouter);
  app.use('/api/journal',   journalRouter);
  app.use('/api/vault',     vaultRouter);
  app.use('/api/orders',    ordersRouter);
  app.use('/api/analysis',  analysisRouter);
  app.use('/api/agent',     agentRouter);
  app.use('/api/sandbox',   sandboxRouter);

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      marketDataAdapter: adapter.name,
      isLive: adapter.isLive,
      connected: adapter.isConnected(),
    });
  });

  app.listen(PORT, () => {
    console.log(`\n🚀 Artha API listening on http://localhost:${PORT}`);
    console.log(`📊 Market data: ${adapter.name} (isLive=${adapter.isLive})`);

    // Warm up shared broker session once at startup (no duplicate TOTP race)
    if (process.env.DEMO_MODE !== 'true') {
      getJwtToken()
        .then(token => {
          if (token) {
            console.log('✅ [BrokerSession] Angel One pre-authenticated at startup.');
            // Trigger historical seed warmup in background
            import('./services/liveMarketService').then(async m => {
              const symbols = m.getActiveSymbols();
              const { warmupSignalEngine } = await import('./services/historicalSeedService');
              const { signalEngine } = await import('./routes/signals.routes');
              await warmupSignalEngine(signalEngine, symbols);
            }).catch(() => {});
          } else {
            console.warn('⚠️  [BrokerSession] Angel One login skipped or credentials missing.');
          }
        })
        .catch(() => {});
    }

    // Start Phase 11 monitoring (lazy import to avoid circular deps)
    import('./services/healthMonitor').then(m => m.startMonitoring()).catch(() => {});
    import('./services/schedulerService').then(m => m.startScheduler()).catch(() => {});
    console.log('📡 System health monitor + scheduler started.');
  });
}

main().catch(err => {
  console.error('Failed to start API server:', err);
  process.exit(1);
});
