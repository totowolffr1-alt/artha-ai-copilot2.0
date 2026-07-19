-- ============================================================
-- 012_audit_log.sql
-- Artha AI — Phase 3G M5 (gap fill) + SEC4
-- Tables: key_versions, audit_log (append-only chain-hashed)
-- Required for real-money trading compliance.
-- ============================================================

-- ─── key_versions ─────────────────────────────────────────────────────────────
-- Key rotation registry for pgcrypto chain hash verification.
-- Each audit_log row stores key_id so old rows stay verifiable with original key.

CREATE TABLE key_versions (
  key_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  activated_at  timestamptz NOT NULL DEFAULT now(),
  deprecated_at timestamptz             -- NULL = currently active
);

-- Only one active key at a time
CREATE UNIQUE INDEX idx_key_versions_active
  ON key_versions (activated_at DESC)
  WHERE deprecated_at IS NULL;

-- ─── audit_log ────────────────────────────────────────────────────────────────
-- Append-only. No UPDATE/DELETE on this table ever.
-- chain_hash = pgcrypto digest of (previous_hash || new_values::text).
-- Phase 3A SEC4: provides tamper-evident trail for real-money trading audit.

CREATE TABLE audit_log (
  audit_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  varchar(50) NOT NULL,
  operation   varchar(10) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE')),
  row_id      uuid        NOT NULL,   -- PK of the mutated row
  changed_by  varchar(100),           -- account_id or system process name
  old_values  jsonb,                  -- NULL on INSERT
  new_values  jsonb       NOT NULL,
  chain_hash  text        NOT NULL,   -- pgcrypto hash of (prev_hash || new_values)
  key_id      uuid        NOT NULL REFERENCES key_versions (key_id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only enforced: no DELETE/UPDATE grants to artha_writer role (see 018_rbac.sql)

CREATE INDEX idx_audit_table_recorded
  ON audit_log (table_name, recorded_at DESC);

CREATE INDEX idx_audit_row
  ON audit_log (row_id, recorded_at DESC);
