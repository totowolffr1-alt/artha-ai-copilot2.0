-- ============================================================
-- 008_orders_executions.sql
-- Artha AI — Phase 3C
-- Tables: orders, executions (append-only fill record)
-- Depends on: symbols (004), trades (007)
-- ============================================================

-- ─── orders ──────────────────────────────────────────────────────────────────
-- Broker-facing order. One trade has minimum one entry order;
-- typically also SL and TP bracket orders.

CREATE TABLE orders (
  order_id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id         uuid          NOT NULL REFERENCES trades (trade_id),
  symbol_id        uuid          NOT NULL REFERENCES symbols (symbol_id),  -- denormalised for reconciliation
  broker_order_id  varchar(50),                -- SmartAPI order ID; NULL until acked
  order_type       varchar(10)   NOT NULL
    CHECK (order_type IN ('MARKET', 'LIMIT', 'SL', 'SL-M')),
  direction        varchar(5)    NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  qty              numeric(12,0) NOT NULL CHECK (qty > 0),
  price            numeric(12,2),              -- NULL for MARKET orders
  trigger_price    numeric(12,2),              -- Required for SL, SL-M
  product_type     varchar(10)   NOT NULL,     -- CNC, MIS, NRML
  validity         varchar(5)    NOT NULL DEFAULT 'DAY'
    CHECK (validity IN ('DAY', 'IOC', 'GTD')),
  status           order_st      NOT NULL DEFAULT 'pending',
  reject_reason    varchar(500),               -- Broker rejection message verbatim
  placed_at        timestamptz,
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_orders_trade
  ON orders (trade_id, placed_at);

CREATE UNIQUE INDEX idx_orders_broker_id
  ON orders (broker_order_id)
  WHERE broker_order_id IS NOT NULL;

CREATE INDEX idx_orders_open
  ON orders (trade_id, placed_at)
  WHERE status IN ('pending', 'placed', 'open', 'partial');

CREATE INDEX idx_orders_symbol_placed
  ON orders (symbol_id, placed_at DESC);

-- ─── executions ──────────────────────────────────────────────────────────────
-- Immutable fill record. Never updated after INSERT.
-- Append-only enforced at application layer (no UPDATE/DELETE grants to artha_writer).

CREATE TABLE executions (
  execution_id   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid          NOT NULL REFERENCES orders (order_id),
  trade_id       uuid          NOT NULL REFERENCES trades (trade_id),  -- denormalised for P&L path
  broker_fill_id varchar(50)   UNIQUE,                                 -- Dedup guard
  fill_qty       numeric(12,0) NOT NULL CHECK (fill_qty > 0),
  fill_price     numeric(12,2) NOT NULL CHECK (fill_price > 0),
  commission     numeric(10,4) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  exchange_seg   varchar(10),                  -- NSE, BSE, NFO, MCX
  exchange_ts    timestamptz,                  -- Exchange-confirmed fill timestamp
  received_ts    timestamptz   NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_executions_trade
  ON executions (trade_id, exchange_ts);

CREATE INDEX idx_executions_order
  ON executions (order_id);

CREATE UNIQUE INDEX idx_executions_broker_fill
  ON executions (broker_fill_id)
  WHERE broker_fill_id IS NOT NULL;

CREATE INDEX idx_executions_received
  ON executions (received_ts DESC);
