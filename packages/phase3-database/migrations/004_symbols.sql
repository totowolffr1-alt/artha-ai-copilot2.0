-- ============================================================
-- 004_symbols.sql
-- Artha AI — Phase 3B
-- Central instrument registry. All other tables FK here.
-- ============================================================

CREATE TABLE symbols (
  symbol_id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker            varchar(50)   NOT NULL,
  name              varchar(200),
  exchange          exchange_t    NOT NULL,
  asset_type        asset_type_t  NOT NULL,
  lot_size          numeric(12,0) NOT NULL DEFAULT 1,
  tick_size         numeric(8,4)  NOT NULL DEFAULT 0.05,
  isin              varchar(12),
  broker_token      varchar(20),                -- SmartAPI numeric token
  broker_exch_type  smallint,                   -- SmartAPI exchange type code (1–13)
  is_active         boolean       NOT NULL DEFAULT true,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

-- Canonical lookup: how Phase 2 normalizer resolves ticks
CREATE UNIQUE INDEX idx_symbols_exchange_ticker
  ON symbols (exchange, ticker);

-- Broker token lookup (nullable — only set for subscribable instruments)
CREATE UNIQUE INDEX idx_symbols_broker_token
  ON symbols (broker_token)
  WHERE broker_token IS NOT NULL;

-- Active symbol filter (instrument master sync hot path)
CREATE INDEX idx_symbols_active
  ON symbols (exchange, asset_type)
  WHERE is_active = true;

-- ─── Deferred FK from 003_accounts_sessions.sql ──────────────────────────────
-- Now that symbols exists, add the FK from active_subscriptions.symbol_id

ALTER TABLE active_subscriptions
  ADD CONSTRAINT fk_active_sub_symbol
  FOREIGN KEY (symbol_id) REFERENCES symbols (symbol_id);
