-- ============================================================
-- 007_signals_trades.sql
-- Artha AI — Phase 3C
-- Tables: signals, trades
-- Depends on: symbols (004), strategy_runs (006), accounts (003)
-- ============================================================

-- ─── signals ─────────────────────────────────────────────────────────────────
-- Output of the signal engine. One row per signal fired.
-- Decoupled from trades — not every signal results in a trade.

CREATE TABLE signals (
  signal_id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id          uuid          NOT NULL REFERENCES symbols (symbol_id),
  strategy_run_id    uuid          REFERENCES strategy_runs (strategy_run_id),  -- NULL = manual
  signal_type        varchar(30)   NOT NULL,   -- e.g. 'momentum_breakout', 'mean_reversion'
  direction          varchar(5)    NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  strength           numeric(6,4)  NOT NULL CHECK (strength >= 0 AND strength <= 1),
  entry_price_hint   numeric(12,2),            -- Suggested entry; informational only
  stop_loss          numeric(12,2),
  take_profit        numeric(12,2),
  kelly_fraction     numeric(6,4)  CHECK (kelly_fraction > 0 AND kelly_fraction <= 1),
  regime             varchar(30),
  features           jsonb         NOT NULL DEFAULT '{}',  -- Raw feature vector snapshot
  status             signal_st     NOT NULL DEFAULT 'pending',
  fired_at           timestamptz   NOT NULL DEFAULT now(),
  expires_at         timestamptz,              -- pg_cron sweeps pending→expired past this
  acted_at           timestamptz,              -- Set when first trade created
  acted_by_trade     uuid                      -- Denormalised link (FK added after trades created)
);

-- Indexes
CREATE INDEX idx_signals_symbol_fired
  ON signals (symbol_id, fired_at DESC);

CREATE INDEX idx_signals_strategy_fired
  ON signals (strategy_run_id, fired_at DESC)
  WHERE strategy_run_id IS NOT NULL;

CREATE INDEX idx_signals_pending
  ON signals (expires_at)
  WHERE status = 'pending';

-- ─── trades ──────────────────────────────────────────────────────────────────
-- Logical trade — full lifecycle from intent to close.
-- Atomic P&L unit. mode column unifies live/paper/backtest.

CREATE TABLE trades (
  trade_id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id         uuid          REFERENCES signals (signal_id),  -- NULL = manual trade
  symbol_id         uuid          NOT NULL REFERENCES symbols (symbol_id),
  account_id        uuid          NOT NULL REFERENCES accounts (account_id),
  mode              varchar(10)   NOT NULL CHECK (mode IN ('live', 'paper', 'backtest')),
  direction         varchar(5)    NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  qty               numeric(12,0) NOT NULL CHECK (qty > 0),
  filled_qty        numeric(12,0) NOT NULL DEFAULT 0,
  avg_entry_price   numeric(12,2),
  avg_exit_price    numeric(12,2),
  realised_pnl      numeric(14,2),
  commission        numeric(10,2) NOT NULL DEFAULT 0,
  slippage          numeric(10,2),
  close_reason      varchar(30),              -- Added proactively (defined formally in 016)
  status            trade_st      NOT NULL DEFAULT 'pending',
  opened_at         timestamptz,
  closed_at         timestamptz,
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_trades_account_status
  ON trades (account_id, status, opened_at DESC);

CREATE INDEX idx_trades_symbol_mode
  ON trades (symbol_id, mode, status);

CREATE INDEX idx_trades_signal
  ON trades (signal_id)
  WHERE signal_id IS NOT NULL;

CREATE INDEX idx_trades_open
  ON trades (account_id, status, opened_at DESC)
  WHERE status IN ('open', 'partial') AND mode = 'live';

CREATE INDEX idx_trades_opened_at
  ON trades (opened_at DESC);

-- ─── Close deferred FK: signals.acted_by_trade → trades ──────────────────────
ALTER TABLE signals
  ADD CONSTRAINT fk_signals_acted_by_trade
  FOREIGN KEY (acted_by_trade) REFERENCES trades (trade_id);
