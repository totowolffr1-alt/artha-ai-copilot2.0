-- ============================================================
-- 015_partitions.sql
-- Artha AI — Phase 3F
-- TimescaleDB retention and compression policies.
-- pg_partman config for trades and positions.
-- ============================================================

-- ─── ticks: compress after 7 days, drop after 90 days ────────────────────────

SELECT add_compression_policy(
  'ticks',
  compress_after => INTERVAL '7 days'
);

ALTER TABLE ticks SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol_id',
  timescaledb.compress_orderby   = 'exchange_ts ASC'
);

SELECT add_retention_policy(
  'ticks',
  drop_after => INTERVAL '90 days'
);

-- ─── candles: compress after 30 days, never drop ─────────────────────────────

ALTER TABLE candles SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol_id,timeframe',
  timescaledb.compress_orderby   = 'bucket_ts ASC'
);

SELECT add_compression_policy(
  'candles',
  compress_after => INTERVAL '30 days'
);

-- No retention policy — historical candles retained permanently.

-- ─── equity_curve: compress after 7 days, drop 1m after 90 days ──────────────

ALTER TABLE equity_curve SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'portfolio_id,granularity',
  timescaledb.compress_orderby   = 'recorded_at ASC'
);

SELECT add_compression_policy(
  'equity_curve',
  compress_after => INTERVAL '7 days'
);

SELECT add_retention_policy(
  'equity_curve',
  drop_after => INTERVAL '90 days'
);

-- Note: 1h and 1d aggregates are created in continuous_aggregates.sql
-- and have their own longer retention configured there.

-- ─── pg_partman: trades (annual range partitions) ────────────────────────────
-- NOTE: pg_partman setup requires the partman schema.
-- Trades table uses range partitioning by opened_at, 1-year intervals.
-- This is configured as a background maintenance task; actual partition
-- conversion requires pg_partman >= 4.0 and superuser first-time setup.
-- The following is a reference comment for the DBA:
--
-- SELECT partman.create_parent(
--   p_parent_table  => 'public.trades',
--   p_control       => 'opened_at',
--   p_interval      => 'yearly',
--   p_type          => 'range'
-- );
--
-- UPDATE partman.part_config SET retention = '5 years', retention_keep_table = true
--   WHERE parent_table = 'public.trades';

-- ─── pg_partman: positions (annual range partitions for closed positions) ─────
-- Similarly for positions. Closed positions older than 1 year detach to
-- positions_archive tablespace. Reference:
--
-- SELECT partman.create_parent(
--   p_parent_table  => 'public.positions',
--   p_control       => 'opened_at',
--   p_interval      => 'yearly',
--   p_type          => 'range'
-- );
--
-- UPDATE partman.part_config SET retention = '1 year', retention_keep_table = true
--   WHERE parent_table = 'public.positions';

-- ─── option_strikes: SC2 scalability note ─────────────────────────────────────
-- At 10 active underlyings, ~17M rows/day. Before Phase 6 (live options):
-- Add pg_partman range partition by captured_at month.
-- Currently a regular table — partitioning deferred per Phase 3G SC2.
