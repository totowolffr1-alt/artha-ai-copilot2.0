-- ============================================================
-- 019_cron_jobs.sql
-- Artha AI — Phase 3F
-- pg_cron scheduled job registrations.
-- Requires pg_cron extension (001) and superuser.
-- All times in UTC (IST = UTC+05:30).
-- ============================================================

-- ─── EOD metrics recompute: 18:30 IST = 13:00 UTC ────────────────────────────
-- Recomputes performance_metrics for all active portfolios.

SELECT cron.schedule(
  'artha_eod_metrics',
  '0 13 * * 1-5',  -- Mon-Fri 13:00 UTC = 18:30 IST
  $$
    -- Application-level call — the actual computation is done by the app service.
    -- pg_cron just fires the trigger; metrics computation happens in the app layer.
    -- This inserts a notification row that the metrics service polls.
    INSERT INTO sync_log (sync_type, started_at, status)
    VALUES ('instrument_master', now(), 'running')
    ON CONFLICT DO NOTHING;
  $$
);

-- ─── Equity curve 1h aggregate refresh: every hour ───────────────────────────
SELECT cron.schedule(
  'artha_equity_curve_1h_refresh',
  '5 * * * *',  -- 5 min past every hour
  $$CALL refresh_continuous_aggregate('equity_curve_1h', NULL, NULL);$$
);

-- ─── Partition maintenance: Sunday 02:00 IST = 20:30 UTC Saturday ────────────
SELECT cron.schedule(
  'artha_partition_maintenance',
  '30 20 * * 6',  -- Saturday 20:30 UTC = Sunday 02:00 IST
  $$SELECT partman.run_maintenance_proc();$$
);

-- ─── Tick FK validation: 01:00 IST = 19:30 UTC (previous day) ────────────────
SELECT cron.schedule(
  'artha_tick_fk_validate',
  '30 19 * * 1-5',  -- Mon-Fri 19:30 UTC = 01:00 IST
  $$
    VALIDATE CONSTRAINT fk_ticks_symbol ON ticks;
  $$
);

-- ─── Index maintenance: Sunday 03:00 IST = 21:30 UTC Saturday ────────────────
SELECT cron.schedule(
  'artha_index_maintenance',
  '30 21 * * 6',  -- Saturday 21:30 UTC = Sunday 03:00 IST
  $$
    REINDEX INDEX CONCURRENTLY idx_signals_pending;
    REINDEX INDEX CONCURRENTLY idx_orders_open;
    REINDEX INDEX CONCURRENTLY idx_trades_open;
    REINDEX INDEX CONCURRENTLY idx_positions_active;
  $$
);

-- ─── Session state purge: 09:00 IST = 03:30 UTC ──────────────────────────────
-- broker_sessions and active_subscriptions are unlogged and rebuilt on connect.
SELECT cron.schedule(
  'artha_session_purge',
  '30 3 * * 1-5',  -- Mon-Fri 03:30 UTC = 09:00 IST
  $$
    TRUNCATE broker_sessions;
    TRUNCATE active_subscriptions;
  $$
);

-- ─── Instrument master sync: 20:00 IST = 14:30 UTC ───────────────────────────
-- Actual upsert is done by the app's InstrumentMasterSyncService.
-- pg_cron fires a flag row; app polls it.
SELECT cron.schedule(
  'artha_instrument_master_sync',
  '30 14 * * 1-5',  -- Mon-Fri 14:30 UTC = 20:00 IST
  $$
    INSERT INTO sync_log (sync_type, started_at, status)
    VALUES ('instrument_master', now(), 'running');
  $$
);

-- ─── Signal expiry sweep ──────────────────────────────────────────────────────
-- Flip pending signals to expired if past expires_at.
SELECT cron.schedule(
  'artha_signal_expiry_sweep',
  '* * * * *',  -- every minute
  $$
    UPDATE signals
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at IS NOT NULL
      AND expires_at < now();
  $$
);
