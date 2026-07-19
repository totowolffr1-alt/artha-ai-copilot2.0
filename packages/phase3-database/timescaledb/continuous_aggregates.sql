-- ============================================================
-- timescaledb/continuous_aggregates.sql
-- Artha AI — Phase 3F
-- TimescaleDB continuous aggregates definition.
-- ============================================================

-- ─── ticks_1m: Rollup from ticks hypertable ─────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS ticks_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', exchange_ts) AS bucket,
  symbol_id,
  first(price, exchange_ts) AS open,
  max(price) AS high,
  min(price) AS low,
  last(price, exchange_ts) AS close,
  sum(volume) AS volume,
  count(*) AS tick_count
FROM ticks
GROUP BY bucket, symbol_id;

-- ─── candles_5m: Rollup from candles hypertable ──────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS candles_5m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('5 minutes', bucket_ts) AS bucket,
  symbol_id,
  first(open, bucket_ts) AS open,
  max(high) AS high,
  min(low) AS low,
  last(close, bucket_ts) AS close,
  sum(volume) AS volume,
  sum(tick_count) AS tick_count
FROM candles
WHERE timeframe = '1m'
GROUP BY bucket, symbol_id;

-- ─── candles_15m: Rollup from candles hypertable ─────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS candles_15m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('15 minutes', bucket_ts) AS bucket,
  symbol_id,
  first(open, bucket_ts) AS open,
  max(high) AS high,
  min(low) AS low,
  last(close, bucket_ts) AS close,
  sum(volume) AS volume,
  sum(tick_count) AS tick_count
FROM candles
WHERE timeframe = '1m'
GROUP BY bucket, symbol_id;

-- ─── candles_1h: Rollup from candles hypertable ──────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS candles_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', bucket_ts) AS bucket,
  symbol_id,
  first(open, bucket_ts) AS open,
  max(high) AS high,
  min(low) AS low,
  last(close, bucket_ts) AS close,
  sum(volume) AS volume,
  sum(tick_count) AS tick_count
FROM candles
WHERE timeframe = '1m'
GROUP BY bucket, symbol_id;

-- ─── candles_1d: Rollup from candles hypertable ──────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS candles_1d
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', bucket_ts) AS bucket,
  symbol_id,
  first(open, bucket_ts) AS open,
  max(high) AS high,
  min(low) AS low,
  last(close, bucket_ts) AS close,
  sum(volume) AS volume,
  sum(tick_count) AS tick_count
FROM candles
WHERE timeframe = '1m'
GROUP BY bucket, symbol_id;

-- ─── equity_curve_1h: Rollup from equity_curve hypertable ────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS equity_curve_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', recorded_at) AS bucket,
  portfolio_id,
  first(equity, recorded_at) AS open,
  max(equity) AS high,
  min(equity) AS low,
  last(equity, recorded_at) AS close,
  last(cash, recorded_at) AS cash,
  last(unrealised_pnl, recorded_at) AS unrealised_pnl,
  max(drawdown_pct) AS max_drawdown_pct
FROM equity_curve
WHERE granularity = '1m'
GROUP BY bucket, portfolio_id;

-- ─── equity_curve_1d: Rollup from equity_curve_1h continuous aggregate ───────
CREATE MATERIALIZED VIEW IF NOT EXISTS equity_curve_1d
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', bucket) AS bucket,
  portfolio_id,
  first(open, bucket) AS open,
  max(high) AS high,
  min(low) AS low,
  last(close, bucket) AS close,
  last(cash, bucket) AS cash,
  last(unrealised_pnl, bucket) AS unrealised_pnl,
  max(max_drawdown_pct) AS max_drawdown_pct
FROM equity_curve_1h
GROUP BY bucket, portfolio_id;

-- ─── Continuous Aggregate Refresh Policies ───────────────────────────────────

SELECT add_continuous_aggregate_policy('ticks_1m',
  start_offset => INTERVAL '2 hours',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute');

SELECT add_continuous_aggregate_policy('candles_5m',
  start_offset => INTERVAL '6 hours',
  end_offset => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '5 minutes');

SELECT add_continuous_aggregate_policy('candles_15m',
  start_offset => INTERVAL '12 hours',
  end_offset => INTERVAL '15 minutes',
  schedule_interval => INTERVAL '15 minutes');

SELECT add_continuous_aggregate_policy('candles_1h',
  start_offset => INTERVAL '24 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('candles_1d',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day');

SELECT add_continuous_aggregate_policy('equity_curve_1h',
  start_offset => INTERVAL '24 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('equity_curve_1d',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day');
