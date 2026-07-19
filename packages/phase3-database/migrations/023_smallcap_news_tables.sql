-- Migration 023: Small-Cap Universe + NSE Corporate Events
-- Supports SmallCapUniverseLoader, NewsEventGuard, and CircuitLimitGuard.

-- ─────────────────────────────────────────────────────────────
-- 1. Small-Cap Universe Table
--    Seeded from NSE Smallcap 100 / Smallcap 250 index lists.
--    Updated monthly (or on demand via admin script).
-- ─────────────────────────────────────────────────────────────

CREATE TYPE smallcap_index AS ENUM (
  'SMALLCAP_100',   -- NSE Nifty Smallcap 100 (more liquid)
  'SMALLCAP_250',   -- NSE Nifty Smallcap 250 (wider, more volatile)
  'MIDCAP_100',     -- Nifty Midcap 100 (for reference)
  'LARGECAP'        -- Nifty 50 / Nifty Next 50
);

CREATE TYPE circuit_category AS ENUM (
  'CAT_A',  -- 20% circuit limit (most liquid small caps)
  'CAT_B',  -- 10% circuit limit
  'CAT_T',  -- Trade-to-Trade (5%) — high surveillance
  'CAT_Z'   -- Z category — suspended/defaulter companies
);

CREATE TABLE IF NOT EXISTS smallcap_universe (
  id               BIGSERIAL PRIMARY KEY,
  symbol           TEXT            NOT NULL UNIQUE,
  company_name     TEXT            NOT NULL,
  isin             TEXT,
  sector           TEXT,
  index_name       smallcap_index  NOT NULL,
  circuit_category circuit_category NOT NULL DEFAULT 'CAT_A',
  avg_daily_volume BIGINT,          -- shares traded per day (for liquidity check)
  market_cap_cr    NUMERIC(18, 2),  -- market cap in crores
  is_active        BOOLEAN         NOT NULL DEFAULT TRUE,
  added_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  last_updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smallcap_universe_symbol
  ON smallcap_universe (symbol)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_smallcap_universe_index
  ON smallcap_universe (index_name)
  WHERE is_active = TRUE;

COMMENT ON TABLE smallcap_universe IS
  'NSE Smallcap 100 & 250 constituents. Used by SmallCapUniverseLoader '
  'to tag symbols with their risk profile and circuit limit category.';


-- ─────────────────────────────────────────────────────────────
-- 2. NSE Corporate Events Table
--    Seeded from NSE corporate calendar (earnings, dividends, etc.)
--    Used by NewsEventGuard to suppress signals in blackout windows.
-- ─────────────────────────────────────────────────────────────

CREATE TYPE corporate_event_type AS ENUM (
  'EARNINGS',         -- Quarterly/annual results
  'DIVIDEND',         -- Dividend announcement
  'AGM',              -- Annual General Meeting
  'BOARD_MEETING',    -- Board meeting (often results in major announcements)
  'STOCK_SPLIT',      -- Stock split / bonus issue
  'RIGHTS_ISSUE',     -- Rights issue
  'SEBI_NOTICE',      -- SEBI regulatory action
  'MERGER',           -- Merger / acquisition announcement
  'DELISTING',        -- Delisting notice
  'OTHER'
);

CREATE TABLE IF NOT EXISTS nse_corporate_events (
  id             BIGSERIAL PRIMARY KEY,
  symbol         TEXT                  NOT NULL,
  event_type     corporate_event_type  NOT NULL,
  event_date     DATE                  NOT NULL,
  description    TEXT,
  is_confirmed   BOOLEAN               NOT NULL DEFAULT TRUE,
  blackout_hours INT                   NOT NULL DEFAULT 48, -- hours before event to suppress
  created_at     TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nse_events_symbol_date
  ON nse_corporate_events (symbol, event_date);

CREATE INDEX IF NOT EXISTS idx_nse_events_upcoming
  ON nse_corporate_events (event_date)
  WHERE event_date >= CURRENT_DATE;

COMMENT ON TABLE nse_corporate_events IS
  'NSE corporate calendar events. NewsEventGuard checks this table '
  'to suppress signals within blackout_hours before each event, '
  'preventing entries ahead of earnings/results surprises.';


-- ─────────────────────────────────────────────────────────────
-- 3. Circuit Hit Log
--    Recorded by CircuitLimitGuard when a stock hits its daily circuit.
-- ─────────────────────────────────────────────────────────────

CREATE TYPE circuit_direction AS ENUM ('UPPER', 'LOWER');

CREATE TABLE IF NOT EXISTS circuit_hit_log (
  id               BIGSERIAL PRIMARY KEY,
  symbol           TEXT               NOT NULL,
  circuit_direction circuit_direction  NOT NULL,
  circuit_pct      NUMERIC(5, 2)      NOT NULL,  -- 5, 10, or 20
  ltp_at_hit       NUMERIC(18, 4)     NOT NULL,
  recorded_at      TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_circuit_hit_log_symbol_date
  ON circuit_hit_log (symbol, recorded_at DESC);

COMMENT ON TABLE circuit_hit_log IS
  'Phase 9: Records when a symbol hits its NSE circuit filter. '
  'CircuitLimitGuard queries this table to block new entries on halted stocks.';
