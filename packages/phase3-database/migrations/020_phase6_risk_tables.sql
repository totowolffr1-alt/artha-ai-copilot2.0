-- ============================================================
-- 020_phase6_risk_tables.sql
-- Artha AI — Phase 6 Risk Engine
-- Additive tables for risk auditing, drawdown logging,
-- corporate events calendar, market status, and SEBI actions.
-- ============================================================

-- ─── risk_snapshots ─────────────────────────────────────────────────────────
-- Periodic risk snapshots for audit trail and Phase 9 safety monitoring.
CREATE TABLE risk_snapshots (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_run_id           UUID REFERENCES strategy_runs(strategy_run_id),
  captured_at               TIMESTAMPTZ NOT NULL,
  market_state              TEXT NOT NULL,
  risk_budget_multiplier    NUMERIC(4,3) NOT NULL,
  daily_dd_pct              NUMERIC(6,3) NOT NULL,
  weekly_dd_pct             NUMERIC(6,3) NOT NULL,
  monthly_dd_pct            NUMERIC(6,3) NOT NULL,
  total_dd_pct              NUMERIC(6,3) NOT NULL,
  net_long_exposure_pct     NUMERIC(6,3) NOT NULL,
  largest_stock_pct         NUMERIC(6,3) NOT NULL,
  largest_sector_pct        NUMERIC(6,3) NOT NULL,
  portfolio_var_1d_95_pct   NUMERIC(6,3) NOT NULL,
  portfolio_heat            NUMERIC(4,3),
  circuit_breaker_state     TEXT NOT NULL,
  open_position_count       INT NOT NULL,
  snapshot_type             TEXT NOT NULL,      -- 'periodic'|'on_trip'|'on_signal'
  detail                    JSONB
);

CREATE INDEX idx_risk_snapshots_run
  ON risk_snapshots(strategy_run_id, captured_at DESC);

-- ─── exposure_log ────────────────────────────────────────────────────────────
-- Per-signal exposure state after Stage 1 validation.
CREATE TABLE exposure_log (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id                 UUID REFERENCES signals(signal_id),
  logged_at                 TIMESTAMPTZ NOT NULL,
  symbol_id                 UUID REFERENCES symbols(symbol_id),
  sector                    TEXT NOT NULL,
  stock_exposure_before_pct NUMERIC(6,3) NOT NULL,
  stock_exposure_after_pct  NUMERIC(6,3) NOT NULL,
  sector_exposure_after_pct NUMERIC(6,3) NOT NULL,
  net_long_after_pct        NUMERIC(6,3) NOT NULL,
  approved_qty              INT NOT NULL,
  partial_fill              BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_exposure_log_signal
  ON exposure_log(signal_id);

-- ─── drawdown_log ────────────────────────────────────────────────────────────
-- Drawdown watermark transitions and breaches.
CREATE TABLE drawdown_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_run_id  UUID REFERENCES strategy_runs(strategy_run_id),
  logged_at        TIMESTAMPTZ NOT NULL,
  event_type       TEXT NOT NULL,        -- 'hwm_update'|'limit_breach'|'watermark_reset'
  horizon          TEXT NOT NULL,        -- 'daily'|'weekly'|'monthly'|'total'
  equity           NUMERIC(15,2) NOT NULL,
  hwm              NUMERIC(15,2) NOT NULL,
  dd_pct           NUMERIC(6,3) NOT NULL,
  limit_pct        NUMERIC(6,3),
  detail           TEXT
);

CREATE INDEX idx_drawdown_log_run
  ON drawdown_log(strategy_run_id, logged_at DESC);

-- ─── market_status ───────────────────────────────────────────────────────────
-- NSE/SEBI regulatory status per symbol per date.
CREATE TABLE market_status (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id    UUID REFERENCES symbols(symbol_id),
  status_date  DATE NOT NULL,
  status_type  TEXT NOT NULL,           -- 'FNO_BAN'|'ASM'|'GSM_1'..'GSM_6'|'T2T'|'CIRCUIT_FREEZE'
  detail       TEXT,
  source       TEXT NOT NULL            -- 'NSE_BHAV'|'NSE_SURVEILLANCE'|'MANUAL'
);

CREATE UNIQUE INDEX idx_market_status_sym_date_type
  ON market_status(symbol_id, status_date, status_type);

-- ─── sebi_actions ────────────────────────────────────────────────────────────
-- SEBI enforcement actions and investigations.
CREATE TABLE sebi_actions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id      UUID REFERENCES symbols(symbol_id),
  action_type    TEXT NOT NULL,         -- 'TRADING_HALT'|'TRADING_RESTRICTION'|'INVESTIGATION_OPEN'|'FREEZE_ORDER'|'INSIDER_TRADING_PROBE'|'SHOW_CAUSE_NOTICE'
  effective_date DATE NOT NULL,
  lifted_date    DATE,                  -- NULL = still active
  detail         TEXT,
  source_url     TEXT
);

CREATE INDEX idx_sebi_actions_sym
  ON sebi_actions(symbol_id, effective_date);

-- ─── corporate_events ────────────────────────────────────────────────────────
-- Additive: corporate events calendar for dividends, earnings, splits etc.
CREATE TABLE corporate_events (
  event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id     UUID REFERENCES symbols(symbol_id),
  event_date    DATE NOT NULL,
  event_type    TEXT NOT NULL,          -- 'EARNINGS'|'DIVIDEND'|'BONUS'|'SPLIT'|'AGM'|'EGM'
  gap_pct_estimate NUMERIC(5,2),        -- historical gap size estimate
  detail        TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_corporate_events_sym_date
  ON corporate_events(symbol_id, event_date);
