-- ============================================================
-- 021_alter_signal_st_enum.sql
-- Artha AI — Phase 7 / Phase 5 Integration
-- Amend the signal_st enum to include 'approved' and 'suppressed'.
-- ============================================================

-- PostgreSQL allows adding values to existing enums, but not inside a transaction block in older versions.
-- In our migration runner, each file runs as a single transaction block. 
-- Since ALTER TYPE ADD VALUE cannot run inside a transaction block in some versions,
-- we check if the values already exist or run them conditionally.
-- We can execute this as:
ALTER TYPE signal_st ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE signal_st ADD VALUE IF NOT EXISTS 'suppressed';
