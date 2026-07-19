-- ============================================================
-- 011_risk_limits.sql
-- Artha AI — Phase 3G M4 (gap fill)
-- Phase 4E RiskValidationPipeline reads risk_limits at stages 1-6.
-- Depends on: accounts (003)
-- ============================================================

CREATE TABLE risk_limits (
  limit_id     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid          NOT NULL REFERENCES accounts (account_id),
  limit_type   varchar(50)   NOT NULL,
  -- Example limit_type values:
  --   'max_daily_loss'            — max rupee loss per trading day
  --   'max_daily_loss_pct'        — max % of capital lost per day
  --   'max_position_fraction'     — max single position as fraction of capital
  --   'max_open_positions'        — max concurrent open trades
  --   'max_order_value'           — max single order value in rupees
  --   'max_portfolio_drawdown_pct'— halt trading if portfolio DD exceeds this
  --   'min_kelly_fraction'        — minimum kelly required to act on signal
  --   'max_concentration_pct'     — max % in one sector/symbol
  limit_value  numeric(16,6) NOT NULL,
  is_active    boolean       NOT NULL DEFAULT true,
  updated_at   timestamptz   NOT NULL DEFAULT now()
);

-- Lookup: RiskValidationPipeline reads by (account_id, limit_type, is_active)
CREATE INDEX idx_risk_limits_account
  ON risk_limits (account_id, limit_type)
  WHERE is_active = true;

-- Uniqueness per account+type to enforce one active limit per type per account
CREATE UNIQUE INDEX idx_risk_limits_unique_type
  ON risk_limits (account_id, limit_type)
  WHERE is_active = true;
