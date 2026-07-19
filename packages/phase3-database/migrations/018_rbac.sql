-- ============================================================
-- 018_rbac.sql
-- Artha AI — Phase 3G SEC3
-- Three roles: artha_writer, artha_reader, artha_admin
-- Column-level revokes per SEC5.
-- ============================================================

-- ─── Create roles ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'artha_admin') THEN
    CREATE ROLE artha_admin;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'artha_writer') THEN
    CREATE ROLE artha_writer;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'artha_reader') THEN
    CREATE ROLE artha_reader;
  END IF;
END; $$;

-- ─── artha_admin: schema migration privileges ─────────────────────────────────
-- Used by migration runner only; never active application connections.

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO artha_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO artha_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO artha_admin;

-- ─── artha_writer: application runtime ───────────────────────────────────────
-- INSERT / UPDATE on trading tables. No DELETE on executions (append-only).
-- No UPDATE/DELETE on audit_log.

GRANT SELECT ON ALL TABLES IN SCHEMA public TO artha_writer;
GRANT INSERT, UPDATE ON
  accounts, broker_sessions, active_subscriptions,
  symbols, ticks, candles, option_chain_snapshots, option_strikes,
  strategy_runs, signals, trades, orders,
  portfolios, positions, equity_curve, performance_metrics,
  learning_records, strategy_performance, indicator_performance, regime_performance,
  risk_limits, sync_log, key_versions
  TO artha_writer;

-- executions: INSERT only (append-only enforced — no UPDATE/DELETE)
GRANT INSERT ON executions TO artha_writer;

-- audit_log: INSERT only
GRANT INSERT ON audit_log TO artha_writer;

-- ─── artha_reader: read-only replica + backtest ───────────────────────────────

GRANT SELECT ON ALL TABLES IN SCHEMA public TO artha_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO artha_reader;

-- ─── SEC5: Revoke sensitive columns from artha_reader ─────────────────────────
-- broker_token + broker_exch_type combined with a SmartAPI session allow
-- subscription to any instrument. Reader role must not see these.

REVOKE SELECT ON symbols FROM artha_reader;
GRANT SELECT (
  symbol_id, ticker, name, exchange, asset_type,
  lot_size, tick_size, isin, is_active, created_at, updated_at
) ON symbols TO artha_reader;
-- broker_token and broker_exch_type are intentionally excluded above.

-- ─── RLS: Enable Row-Level Security per SEC2 ─────────────────────────────────
-- Policy: each session sees only rows matching its current_setting('app.account_id')
-- This must be set by the application on connection: SET app.account_id = '<uuid>'

ALTER TABLE trades    ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;

-- RLS policies for artha_writer (reads own account data)
CREATE POLICY policy_trades_account ON trades
  USING (account_id = current_setting('app.account_id', true)::uuid);

CREATE POLICY policy_portfolios_account ON portfolios
  USING (account_id = current_setting('app.account_id', true)::uuid);

CREATE POLICY policy_positions_portfolio ON positions
  USING (portfolio_id IN (
    SELECT portfolio_id FROM portfolios
    WHERE account_id = current_setting('app.account_id', true)::uuid
  ));

CREATE POLICY policy_orders_trade ON orders
  USING (trade_id IN (
    SELECT trade_id FROM trades
    WHERE account_id = current_setting('app.account_id', true)::uuid
  ));

CREATE POLICY policy_executions_trade ON executions
  USING (trade_id IN (
    SELECT trade_id FROM trades
    WHERE account_id = current_setting('app.account_id', true)::uuid
  ));

-- artha_admin bypasses RLS
ALTER TABLE trades     FORCE ROW LEVEL SECURITY;
ALTER TABLE positions  FORCE ROW LEVEL SECURITY;
ALTER TABLE orders     FORCE ROW LEVEL SECURITY;
ALTER TABLE executions FORCE ROW LEVEL SECURITY;
ALTER TABLE portfolios FORCE ROW LEVEL SECURITY;
