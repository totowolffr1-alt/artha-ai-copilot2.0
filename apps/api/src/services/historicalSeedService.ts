/**
 * historicalSeedService.ts — Historical data seeding for indicator warmup
 *
 * Fetches the last 200 historical candles (either 1m for intraday or 1d for swing)
 * from Yahoo Finance and feeds them sequentially to warm up the SignalEngine's
 * indicator pipeline (EMA50, RSI14, MACD, etc.).
 *
 * This ensures the first live tick processed triggers a signal based on fully
 * converged indicators rather than NaNs or cold states.
 */

import axios from 'axios';
import { SignalEngine } from '../../../../packages/phase5-strategy/src/signals/SignalEngine';

// ── Yahoo Finance Fetcher ──────────────────────────────────────────────────────
async function fetchWarmupCandles(symbol: string, isIntraday = true): Promise<any[]> {
  const upper = symbol.toUpperCase().trim();
  const ticker = upper.includes('.') ? upper : `${upper}.NS`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;

  // 1m for intraday (5 days of history provides ~1800 candles, plenty for 200 warmup)
  // 1d for swing (1 year of history provides ~250 candles)
  const range = isIntraday ? '5d' : '1y';
  const interval = isIntraday ? '1m' : '1d';

  try {
    const { data } = await axios.get(url, {
      params: { range, interval, includePrePost: false },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 8000,
    });

    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps: number[] = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const { open = [], high = [], low = [], close = [], volume = [] } = quote;

    const candles = timestamps.map((ts: number, i: number) => ({
      timestamp: new Date(ts * 1000),
      open: parseFloat((open[i] || 0).toFixed(2)),
      high: parseFloat((high[i] || 0).toFixed(2)),
      low: parseFloat((low[i] || 0).toFixed(2)),
      close: parseFloat((close[i] || 0).toFixed(2)),
      volume: volume[i] || 0,
    })).filter((c: any) => c.close > 0);

    // Return last 200 candles for warmup
    return candles.slice(-200);
  } catch (err: any) {
    console.warn(`[HistoricalSeed] Failed to fetch warmup candles for ${symbol}:`, err.message);
    return [];
  }
}

// ── Warmup Execution ───────────────────────────────────────────────────────────
export async function warmupSignalEngine(
  signalEngine: SignalEngine,
  symbols: string[]
): Promise<void> {
  const mode = process.env.TRADING_MODE || 'INTRADAY';
  const isIntraday = mode === 'INTRADAY';

  console.log(`[HistoricalSeed] Starting SignalEngine warmup for ${symbols.length} symbols (Mode: ${mode})...`);

  for (const symbol of symbols) {
    try {
      const candles = await fetchWarmupCandles(symbol, isIntraday);
      if (candles.length === 0) {
        console.warn(`[HistoricalSeed] ⚠️ No historical candles returned for ${symbol}.`);
        continue;
      }

      console.log(`[HistoricalSeed] Feeding ${candles.length} historical bars for ${symbol}...`);
      signalEngine.resetSymbol(symbol);

      for (const bar of candles) {
        // Feed sequentially; ignore return value during seeding/warmup
        signalEngine.processBar(
          symbol,
          bar.open,
          bar.high,
          bar.low,
          bar.close,
          bar.volume,
          bar.timestamp
        );
      }
      console.log(`[HistoricalSeed] ✅ ${symbol} warmed up successfully.`);
    } catch (err: any) {
      console.error(`[HistoricalSeed] ❌ Warmup failed for ${symbol}:`, err.message);
    }
  }

  console.log('[HistoricalSeed] Warmup finished.');
}
