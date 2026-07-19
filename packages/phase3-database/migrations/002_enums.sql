-- ============================================================
-- 002_enums.sql
-- Artha AI — Phase 3B / 3C / 3D
-- All domain enum types. Must precede all table migrations.
-- ============================================================

-- Exchange segments — canonical labels used across all tables
CREATE TYPE exchange_t AS ENUM (
  'NSE',   -- NSE Cash Market (equities, indices)
  'BSE',   -- BSE Cash Market
  'NFO',   -- NSE Futures & Options
  'BFO',   -- BSE Futures & Options
  'MCX',   -- Multi Commodity Exchange
  'CDS'    -- Currency Derivatives Segment
);

-- Asset classification
CREATE TYPE asset_type_t AS ENUM (
  'equity',
  'index',
  'futures',
  'options',
  'commodity',
  'currency',
  'etf'
);

-- Supported OHLCV timeframes (stored as DB-level enum for constraint enforcement)
CREATE TYPE timeframe_t AS ENUM (
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '1d',
  '1w'
);

-- Candle lifecycle state
CREATE TYPE candle_st AS ENUM (
  'partial',  -- candle still forming; CandleAggregator fires CANDLE_UPDATED
  'closed'    -- candle final; CandleAggregator fires CANDLE_FORMED
);

-- Signal lifecycle
CREATE TYPE signal_st AS ENUM (
  'pending',    -- not yet acted upon
  'acted',      -- a trade was opened from this signal
  'expired',    -- pg_cron swept past expires_at
  'rejected',   -- risk engine rejected
  'cancelled'   -- manual cancellation
);

-- Logical trade lifecycle
CREATE TYPE trade_st AS ENUM (
  'pending',    -- created, no fill yet
  'open',       -- fully filled entry
  'partial',    -- partially filled entry
  'closed',     -- fully exited
  'cancelled',  -- cancelled before any fill
  'rejected'    -- broker/risk rejection
);

-- Broker order lifecycle
CREATE TYPE order_st AS ENUM (
  'pending',    -- not yet sent to broker
  'placed',     -- sent to broker, awaiting ack
  'open',       -- acked, sitting in order book
  'partial',    -- partially filled
  'complete',   -- fully filled
  'cancelled',  -- cancelled
  'rejected'    -- broker rejection
);

-- Position lifecycle
CREATE TYPE position_st AS ENUM (
  'open',       -- full qty still held
  'partial',    -- some qty exited
  'closed'      -- all qty exited, qty = 0
);
