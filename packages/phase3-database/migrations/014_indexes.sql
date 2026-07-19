-- ============================================================
-- 014_indexes.sql
-- Artha AI — Phase 3F
-- All hot-path, analytical, and write-path indexes.
-- Most indexes were created inline with their tables (007-013).
-- This file adds covering indexes for the analytical path and
-- any cross-table indexes that couldn't be created inline.
-- ============================================================

-- ─── Hot path (sub-millisecond, market hours) — supplements inline indexes ───

-- Signal engine: pending signals for expiry sweep (already in 007)
-- Open order monitor (already in 008)
-- Active position lookup (already in 009)

-- ─── Analytical path — covering indexes for backtesting ───────────────────────

-- Candle range scan — primary backtest access pattern
-- COVERING INDEX: includes OHLCV so heap fetch is avoided entirely
CREATE INDEX IF NOT EXISTS idx_candles_backtest
  ON candles (symbol_id, timeframe, bucket_ts DESC)
  INCLUDE (open, high, low, close, volume);

-- Tick range for CandleAggregator replay
CREATE INDEX IF NOT EXISTS idx_ticks_replay
  ON ticks (symbol_id, exchange_ts DESC)
  INCLUDE (price, volume, bid, ask);

-- Trade P&L aggregation by strategy run (analytics path)
CREATE INDEX IF NOT EXISTS idx_trades_strategy
  ON trades (account_id, mode, opened_at DESC)
  INCLUDE (realised_pnl, commission, slippage);

-- Learning records by regime (model training scan)
CREATE INDEX IF NOT EXISTS idx_learning_regime_scan
  ON learning_records (regime, trade_closed_at DESC)
  INCLUDE (was_winner, actual_return, predicted_return, kelly_used);

-- Option chain latest snapshot (Greeks and IV lookup)
CREATE INDEX IF NOT EXISTS idx_option_chain_latest_cov
  ON option_chain_snapshots (underlying_id, expiry, captured_at DESC);

-- ─── Write path — executions append path ─────────────────────────────────────

-- Additional execution lookup by trade + time (already in 008 but re-verified here)
CREATE INDEX IF NOT EXISTS idx_executions_trade_ts
  ON executions (trade_id, exchange_ts);

-- ─── Additional signal engine reads ──────────────────────────────────────────

-- Strategy performance latest by strategy (signal engine hot read)
CREATE INDEX IF NOT EXISTS idx_strat_perf_latest
  ON strategy_performance (strategy_run_id, regime, period_end DESC)
  INCLUDE (regime_fitness, win_rate, sharpe_ratio);

-- Regime performance for next-bar signal weighting
CREATE INDEX IF NOT EXISTS idx_regime_perf_latest
  ON regime_performance (regime, timeframe, period_end DESC)
  INCLUDE (indicator_rankings, avg_return_pct, win_rate);
