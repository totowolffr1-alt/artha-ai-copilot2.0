-- ============================================================
-- 017_strategy_runs_reports.sql
-- Artha AI — Phase 4H Correction 2
-- strategy_runs.reports_jsonb was defined in design and pre-declared in 006.
-- This migration is a no-op if 006 already includes reports_jsonb.
-- Kept for migration sequence integrity.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategy_runs' AND column_name = 'reports_jsonb'
  ) THEN
    ALTER TABLE strategy_runs ADD COLUMN reports_jsonb jsonb;
    COMMENT ON COLUMN strategy_runs.reports_jsonb IS
      'Phase 4G ReportRegistry output — full report data for dashboard rendering';
  END IF;
END;
$$;
