-- ============================================================
-- 001_extensions.sql
-- Artha AI — Phase 3A
-- Install all required PostgreSQL extensions.
-- Must run as superuser. Run ONCE on a fresh database.
-- ============================================================

-- Core time-series: chunk management, continuous aggregates, compression
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Partition management: automatic range partition lifecycle for trades/positions
CREATE EXTENSION IF NOT EXISTS pg_partman;

-- Scheduled jobs: EOD metrics recompute, tick FK validation, session purge
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- UUID generation: gen_random_uuid() used on all PK columns
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Cryptography: pgp_sym_encrypt for broker tokens, chain_hash for audit log
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure timescaledb is loaded first in shared_preload_libraries
-- NOTE: Add 'timescaledb' and 'pg_cron' to shared_preload_libraries in postgresql.conf
-- and restart before running this migration.
