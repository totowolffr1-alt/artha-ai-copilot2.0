-- ============================================================
-- 005_market_data.sql
-- Artha AI — Phase 3B
-- Tables: ticks (hypertable), candles (hypertable),
--         option_chain_snapshots, option_strikes
-- ============================================================

-- ─── ticks ───────────────────────────────────────────────────────────────────
-- TimescaleDB hypertable. 1-day chunks partitioned by exchange_ts.
-- Highest write volume: ~50K rows/s peak. Append-only.
-- FK declared NOT VALID — adapter guarantees symbol_id before insert.

CREATE TABLE ticks (
  tick_id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  symbol_id          uuid          NOT NULL,   -- FK validated nightly, not at insert
  exchange_ts        timestamptz   NOT NULL,   -- Unix ms from exchange, stored UTC
  received_ts        timestamptz   NOT NULL DEFAULT now(),
  price              numeric(12,2) NOT NULL,   -- LTP in rupees
  volume             bigint        NOT NULL,   -- Cumulative day volume
  bid                numeric(12,2),            -- NULL if crossed or absent
  ask                numeric(12,2),            -- NULL if crossed or absent
  open_price         numeric(12,2),
  high_price         numeric(12,2),
  low_price          numeric(12,2),
  avg_traded_price   numeric(12,2),
  total_buy_qty      bigint,
  total_sell_qty     bigint,
  session_id         varchar(36)   NOT NULL DEFAULT '',

  -- Crossed spread rejected at DB level
  CONSTRAINT chk_ticks_spread CHECK (bid IS NULL OR ask IS NULL OR bid < ask)
);

-- Add FK not valid (validated nightly by pg_cron)
ALTER TABLE ticks
  ADD CONSTRAINT fk_ticks_symbol
  FOREIGN KEY (symbol_id) REFERENCES symbols (symbol_id)
  NOT VALID;

-- Convert to TimescaleDB hypertable — 1-day chunks
SELECT create_hypertable(
  'ticks',
  'exchange_ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists       => TRUE
);

-- ─── candles ─────────────────────────────────────────────────────────────────
-- TimescaleDB hypertable. 7-day chunks. Upsert on conflict (partial→closed).

CREATE TABLE candles (
  candle_id     uuid          NOT NULL DEFAULT gen_random_uuid(),
  symbol_id     uuid          NOT NULL REFERENCES symbols (symbol_id),
  bucket_ts     timestamptz   NOT NULL,   -- Start of candle interval, UTC
  timeframe     timeframe_t   NOT NULL,
  open          numeric(12,2) NOT NULL,
  high          numeric(12,2) NOT NULL,
  low           numeric(12,2) NOT NULL,
  close         numeric(12,2) NOT NULL,
  volume        bigint        NOT NULL,
  vwap          numeric(12,2),
  delta_volume  bigint,                   -- total_buy_qty - total_sell_qty aggregate
  tick_count    int           NOT NULL DEFAULT 0,
  state         candle_st     NOT NULL DEFAULT 'partial',
  is_partial    boolean       NOT NULL DEFAULT true,

  CONSTRAINT chk_candle_hl     CHECK (high >= low),
  CONSTRAINT chk_candle_h_oc   CHECK (high >= open AND high >= close),
  CONSTRAINT chk_candle_l_oc   CHECK (low <= open AND low <= close),
  -- Upsert target: (symbol_id, timeframe, bucket_ts)
  CONSTRAINT uq_candles_symbol_tf_ts UNIQUE (symbol_id, timeframe, bucket_ts)
);

SELECT create_hypertable(
  'candles',
  'bucket_ts',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists       => TRUE
);

-- ─── option_chain_snapshots ───────────────────────────────────────────────────
-- Point-in-time capture of full option chain for one underlying.

CREATE TABLE option_chain_snapshots (
  snapshot_id       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  underlying_id     uuid          NOT NULL REFERENCES symbols (symbol_id),
  captured_at       timestamptz   NOT NULL,   -- UTC; partition key if promoted
  expiry            date          NOT NULL,   -- NSE weekly/monthly expiry date
  underlying_price  numeric(12,2) NOT NULL,   -- Spot price at capture time
  atm_iv            numeric(8,4),             -- ATM implied volatility
  chain_pcr         numeric(8,4)              -- Total PE OI / Total CE OI (Phase 3G M7)
);

CREATE INDEX idx_option_chain_latest
  ON option_chain_snapshots (underlying_id, expiry, captured_at DESC);

-- ─── option_strikes ───────────────────────────────────────────────────────────
-- Per-strike rows belonging to an option_chain_snapshots record.
-- Phase 3G SC2: add pg_partman range partition by captured_at month before Phase 6.

CREATE TABLE option_strikes (
  strike_id     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id   uuid          NOT NULL REFERENCES option_chain_snapshots (snapshot_id) ON DELETE CASCADE,
  symbol_id     uuid          NOT NULL REFERENCES symbols (symbol_id),
  strike_price  numeric(12,2) NOT NULL CHECK (strike_price > 0),
  option_type   varchar(2)    NOT NULL CHECK (option_type IN ('CE', 'PE')),
  ltp           numeric(12,2),
  iv            numeric(8,4),
  delta         numeric(8,6),
  gamma         numeric(10,8),
  theta         numeric(10,6),   -- Rupees per day
  vega          numeric(10,6),   -- Rupees per 1% IV move
  oi            bigint,
  oi_change     bigint,
  volume        bigint,
  bid           numeric(12,2),
  ask           numeric(12,2),
  bid_qty       numeric(12,0),
  ask_qty       numeric(12,0),
  strike_pcr    numeric(8,4)     -- Per-strike PCR: PE_oi / CE_oi (Phase 3G M7 rename)
);

CREATE INDEX idx_option_strikes_snapshot
  ON option_strikes (snapshot_id, strike_price);
