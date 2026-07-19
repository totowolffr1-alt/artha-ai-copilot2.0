-- ============================================================
-- 003_accounts_sessions.sql
-- Artha AI — Phase 3D + Phase 3G M2 (gap fill)
-- Tables: accounts, broker_sessions (UNLOGGED), active_subscriptions (UNLOGGED)
-- ============================================================

-- ─── accounts ────────────────────────────────────────────────────────────────
-- Root of ownership hierarchy. One account per broker connection.
-- All trades, positions, portfolios FK here for multi-account isolation.

CREATE TABLE accounts (
  account_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_client_id  varchar(20) NOT NULL UNIQUE,       -- SmartAPI clientId
  broker_name       varchar(30) NOT NULL DEFAULT 'AngelOne',
  mode              varchar(10) NOT NULL
    CHECK (mode IN ('live', 'paper', 'backtest')),
  initial_capital   numeric(14,2) NOT NULL CHECK (initial_capital > 0),
  cash_balance      numeric(14,2) NOT NULL DEFAULT 0,
  margin_used       numeric(14,2) NOT NULL DEFAULT 0,
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── broker_sessions (UNLOGGED) ──────────────────────────────────────────────
-- Ephemeral bearer credentials for an active SmartAPI WS connection.
-- UNLOGGED: survives restarts by design — rebuilt on reconnect.
-- Tokens stored encrypted via pgp_sym_encrypt (SEC1).
-- pg_cron truncates this table at 09:00 IST daily.

CREATE UNLOGGED TABLE broker_sessions (
  session_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid        NOT NULL REFERENCES accounts (account_id),
  access_token  text        NOT NULL,   -- pgp_sym_encrypt applied at app layer
  refresh_token text,                   -- pgp_sym_encrypt applied at app layer
  feed_token    text,                   -- pgp_sym_encrypt applied at app layer
  expires_at    timestamptz NOT NULL,
  connected_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_broker_sessions_account
  ON broker_sessions (account_id);

-- ─── active_subscriptions (UNLOGGED) ─────────────────────────────────────────
-- Live market data subscriptions for a session.
-- Rebuilt from WS reconnect logic; never persisted across restarts.

CREATE UNLOGGED TABLE active_subscriptions (
  subscription_id  uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid      NOT NULL,
  symbol_id        uuid      NOT NULL,   -- FK to symbols added in 004
  mode             smallint  NOT NULL    -- SmartAPI mode: 1=LTP, 2=QUOTE, 3=SNAP_QUOTE
    CHECK (mode IN (1, 2, 3)),
  subscribed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_active_subscriptions_account
  ON active_subscriptions (account_id);

-- NOTE: active_subscriptions.symbol_id FK is intentionally deferred.
-- symbols table is created in 004_symbols.sql.
-- Add FK after 004: ALTER TABLE active_subscriptions
--   ADD CONSTRAINT fk_active_sub_symbol FOREIGN KEY (symbol_id) REFERENCES symbols (symbol_id);
-- This ALTER is included at the bottom of 004_symbols.sql.
