-- Migration 022: Phase 9 Safety Tables
-- Creates tables for unexpected fill escalation and startup abort sentinels.
-- Compatible with Phase 9 CancelledFillEscalator and SentinelTransaction modules.

-- ─────────────────────────────────────────────────────────────
-- 1. Unexpected Fills Escrow Table
--    Written by: CancelledFillEscalator.escalate()
--    Resolved by: CancelledFillEscalator.resolveEscrow()
-- ─────────────────────────────────────────────────────────────

CREATE TYPE unexpected_fill_resolution AS ENUM (
  'APPLIED',
  'REJECTED',
  'AUTO_ESCALATED'
);

CREATE TABLE IF NOT EXISTS unexpected_fills (
  id               BIGSERIAL PRIMARY KEY,
  order_id         TEXT        NOT NULL,
  fill_event       JSONB       NOT NULL,           -- full FillEvent payload
  escalated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  resolution       unexpected_fill_resolution,

  -- Audit trail
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by order_id for escrow checks
CREATE INDEX IF NOT EXISTS idx_unexpected_fills_order_id
  ON unexpected_fills (order_id);

-- Unresolved fills query (used for dashboard monitoring)
CREATE INDEX IF NOT EXISTS idx_unexpected_fills_unresolved
  ON unexpected_fills (escalated_at)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE unexpected_fills IS
  'Phase 9: Tracks fills received on orders that were believed to be cancelled/rejected. '
  'Written DB-first before in-memory escrow set update (H4 safety rule).';


-- ─────────────────────────────────────────────────────────────
-- 2. Kill Switch Event Log
--    Audits every EMERGENCY_STOP trigger and ACTIVE reset.
-- ─────────────────────────────────────────────────────────────

CREATE TYPE kill_switch_state AS ENUM (
  'ACTIVE',
  'EMERGENCY_STOP'
);

CREATE TABLE IF NOT EXISTS kill_switch_events (
  id             BIGSERIAL PRIMARY KEY,
  new_state      kill_switch_state NOT NULL,
  previous_state kill_switch_state NOT NULL,
  reason         TEXT,
  triggered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kill_switch_events IS
  'Phase 9: Audit log for every KillSwitch state transition. '
  'Enables post-incident forensics on EMERGENCY_STOP events.';


-- ─────────────────────────────────────────────────────────────
-- 3. Startup Abort Log
--    Records when SentinelTransaction exhausts retries.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS startup_abort_log (
  id           BIGSERIAL PRIMARY KEY,
  reason       TEXT        NOT NULL,
  attempt_count INT        NOT NULL,
  aborted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE startup_abort_log IS
  'Phase 9: Records failed startup sentinel transactions before process.exit(1). '
  'Complements the /tmp/artha_startup_abort sentinel file.';


-- ─────────────────────────────────────────────────────────────
-- 4. Session Rotation Log
--    Tracks every session rotation for crash recovery analysis.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_rotation_log (
  id                     BIGSERIAL PRIMARY KEY,
  session_id             TEXT        NOT NULL,
  rotation_started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotation_completed_at  TIMESTAMPTZ,
  hydration_completed_at TIMESTAMPTZ,
  crashed_during         BOOLEAN     NOT NULL DEFAULT FALSE,
  recovered_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_session_rotation_log_session
  ON session_rotation_log (session_id, rotation_started_at DESC);

COMMENT ON TABLE session_rotation_log IS
  'Phase 9: Records session rotation lifecycle events. '
  'crashed_during=TRUE indicates a ProcessCrashDetector recovery was required.';


-- ─────────────────────────────────────────────────────────────
-- 5. updated_at trigger for unexpected_fills
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_unexpected_fills_updated_at ON unexpected_fills;
CREATE TRIGGER trg_unexpected_fills_updated_at
  BEFORE UPDATE ON unexpected_fills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
