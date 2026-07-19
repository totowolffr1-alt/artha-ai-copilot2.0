-- ============================================================
-- 016_close_reason.sql
-- Artha AI — Phase 4H Correction 1
-- trades.close_reason was defined in design but pre-declared in 007.
-- This migration is a no-op if 007 already includes close_reason
-- (which it does in our implementation). Kept for migration sequence integrity.
-- ============================================================

-- Guard: only add if column doesn't exist (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trades' AND column_name = 'close_reason'
  ) THEN
    ALTER TABLE trades ADD COLUMN close_reason varchar(30);
    COMMENT ON COLUMN trades.close_reason IS
      'Why the trade was closed: sl_triggered | target_hit | timeout_exit | forced_exit | fold_boundary_exit';
  END IF;
END;
$$;
