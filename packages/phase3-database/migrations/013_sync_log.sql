-- ============================================================
-- 013_sync_log.sql
-- Artha AI — Phase 3G M3 (gap fill)
-- pg_cron nightly instrument master sync tracking.
-- ============================================================

CREATE TABLE sync_log (
  sync_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type        varchar(30) NOT NULL
    CHECK (sync_type IN ('instrument_master', 'holiday_calendar')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  rows_upserted    int,
  rows_deactivated int,
  status           varchar(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  error            text
);

CREATE INDEX idx_sync_log_type_started
  ON sync_log (sync_type, started_at DESC);

CREATE INDEX idx_sync_log_status
  ON sync_log (status)
  WHERE status = 'running';
