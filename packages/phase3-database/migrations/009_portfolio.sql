-- ============================================================
-- 009_portfolio.sql
-- Artha AI — Phase 3D
-- Tables: portfolios, positions, equity_curve (hypertable),
--         performance_metrics
-- Depends on: accounts (003), symbols (004), trades (007), strategy_runs (006)
-- ============================================================

-- ─── portfolios ──────────────────────────────────────────────────────────────
-- Snapshot of aggregate portfolio state. Updated on every trade close.

CREATE TABLE portfolios (
  portfolio_id      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid          NOT NULL REFERENCES accounts (account_id),
  name              varchar(100)  NOT NULL,
  mode              varchar(10)   NOT NULL CHECK (mode IN ('live', 'paper', 'backtest')),
  allocated_capital numeric(14,2) NOT NULL CHECK (allocated_capital > 0),
  cash_available    numeric(14,2) NOT NULL DEFAULT 0,
  unrealised_pnl    numeric(14,2) NOT NULL DEFAULT 0,
  realised_pnl      numeric(14,2) NOT NULL DEFAULT 0,
  total_value       numeric(14,2) NOT NULL DEFAULT 0,
  drawdown_pct      numeric(8,4)  NOT NULL DEFAULT 0 CHECK (drawdown_pct >= 0),
  peak_value        numeric(14,2) NOT NULL DEFAULT 0,   -- High-water mark; never decremented
  snapshot_at       timestamptz   NOT NULL DEFAULT now(),
  created_at        timestamptz   NOT NULL DEFAULT now()
);

-- One live portfolio per account
CREATE UNIQUE INDEX idx_portfolios_live
  ON portfolios (account_id, mode)
  WHERE mode = 'live';

-- ─── positions ────────────────────────────────────────────────────────────────
-- Trade-scoped. One row per open or closed position per trade. Not aggregated.

CREATE TABLE positions (
  position_id      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id     uuid          NOT NULL REFERENCES portfolios (portfolio_id),
  symbol_id        uuid          NOT NULL REFERENCES symbols (symbol_id),
  trade_id         uuid          NOT NULL REFERENCES trades (trade_id),  -- 1-to-1 with trade
  direction        varchar(5)    NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  qty              numeric(12,0) NOT NULL CHECK (qty >= 0),
  avg_cost         numeric(12,2) NOT NULL,   -- Weighted average entry incl. commission
  ltp              numeric(12,2),
  unrealised_pnl   numeric(14,2) NOT NULL DEFAULT 0,
  realised_pnl     numeric(14,2) NOT NULL DEFAULT 0,
  mtm_value        numeric(14,2) NOT NULL DEFAULT 0,   -- ltp × qty
  margin_blocked   numeric(12,2) NOT NULL DEFAULT 0,
  status           position_st   NOT NULL DEFAULT 'open',
  opened_at        timestamptz   NOT NULL,
  closed_at        timestamptz,
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- Hot path: active position lookup fires on every tick for subscribed symbols
CREATE INDEX idx_positions_active
  ON positions (symbol_id, portfolio_id)
  WHERE status IN ('open', 'partial');

CREATE INDEX idx_positions_portfolio
  ON positions (portfolio_id, status, opened_at DESC);

-- ─── equity_curve ─────────────────────────────────────────────────────────────
-- TimescaleDB hypertable. Append-only time-series of portfolio value.
-- Written event-driven (trade open/close) and time-driven (bar close).

CREATE TABLE equity_curve (
  point_id        uuid          NOT NULL DEFAULT gen_random_uuid(),
  portfolio_id    uuid          NOT NULL REFERENCES portfolios (portfolio_id),
  recorded_at     timestamptz   NOT NULL,   -- UTC; partition key
  equity          numeric(14,2) NOT NULL,
  cash            numeric(14,2) NOT NULL,
  unrealised_pnl  numeric(14,2) NOT NULL,
  drawdown_pct    numeric(8,4)  NOT NULL,
  drawdown_abs    numeric(14,2) NOT NULL,   -- Rupee drawdown from peak
  open_positions  int           NOT NULL DEFAULT 0,
  granularity     varchar(5)    NOT NULL    -- '1m', '5m', '1h', '1d'
    CHECK (granularity IN ('1m', '5m', '1h', '1d'))
);

SELECT create_hypertable(
  'equity_curve',
  'recorded_at',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists       => TRUE
);

CREATE INDEX idx_equity_curve_portfolio
  ON equity_curve (portfolio_id, recorded_at DESC);

-- ─── performance_metrics ──────────────────────────────────────────────────────
-- Pre-computed summary statistics. One row per (portfolio, period_type, period_start).
-- Safe upsert on recompute via UNIQUE constraint.

CREATE TABLE performance_metrics (
  metric_id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id        uuid          NOT NULL REFERENCES portfolios (portfolio_id),
  strategy_run_id     uuid          REFERENCES strategy_runs (strategy_run_id),  -- NULL = whole-portfolio
  period_start        date          NOT NULL,
  period_end          date          NOT NULL,
  period_type         varchar(10)   NOT NULL
    CHECK (period_type IN ('daily', 'weekly', 'monthly', 'ytd', 'all_time', 'custom')),
  total_return_pct    numeric(10,4),
  cagr_pct            numeric(10,4),          -- NULL if period < 1 year
  sharpe_ratio        numeric(8,4),           -- RF=6.5% RBI repo; NULL if <30 trades
  sortino_ratio       numeric(8,4),
  calmar_ratio        numeric(8,4),           -- NULL if drawdown = 0
  max_drawdown_pct    numeric(8,4)  NOT NULL DEFAULT 0,
  max_drawdown_abs    numeric(14,2) NOT NULL DEFAULT 0,
  win_rate            numeric(6,4),
  profit_factor       numeric(8,4),           -- NULL if no losses
  avg_win             numeric(12,2),
  avg_loss            numeric(12,2),          -- Stored as negative
  expectancy          numeric(12,4),
  avg_rrr             numeric(8,4),           -- Average realised risk-reward ratio
  total_trades        int           NOT NULL DEFAULT 0,
  winning_trades      int           NOT NULL DEFAULT 0,
  losing_trades       int           NOT NULL DEFAULT 0,
  commission_total    numeric(12,2) NOT NULL DEFAULT 0,
  slippage_total      numeric(12,2) NOT NULL DEFAULT 0,
  computed_at         timestamptz   NOT NULL DEFAULT now(),

  -- Safe upsert on recompute
  CONSTRAINT uq_perf_metrics UNIQUE (portfolio_id, strategy_run_id, period_type, period_start)
);

CREATE INDEX idx_perf_metrics_portfolio
  ON performance_metrics (portfolio_id, period_type, period_start DESC);
