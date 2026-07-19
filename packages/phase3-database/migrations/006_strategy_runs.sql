-- ============================================================
-- 006_strategy_runs.sql
-- Artha AI — Phase 3G M1 (gap fill)
-- strategy_runs was referenced by signals, performance tables,
-- and indicator_performance but was never defined. Defined here.
-- Must precede 007_signals_trades.sql.
-- ============================================================

CREATE TABLE strategy_runs (
  strategy_run_id    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id        varchar(100)  NOT NULL,   -- Stable strategy identifier (e.g. 'momentum_breakout_v2')
  strategy_version   int           NOT NULL DEFAULT 1,
  mode               varchar(10)   NOT NULL
    CHECK (mode IN ('backtest', 'paper', 'live')),
  status             varchar(20)   NOT NULL
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'overfit')),
  parameter_snapshot jsonb         NOT NULL,   -- Full ParameterSnapshot — self-contained, reproducible
  summary_metrics    jsonb,                    -- Denormalised all_time metrics for dashboard
  reports_jsonb      jsonb,                    -- Phase 4G ReportRegistry output (added in 017 but pre-declared)
  walk_forward_fold  int,                      -- NULL if not walk-forward run
  started_at         timestamptz,
  completed_at       timestamptz,
  error_message      text,                     -- Populated when status = 'failed'
  created_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_strategy_runs_strategy_id
  ON strategy_runs (strategy_id, created_at DESC);

CREATE INDEX idx_strategy_runs_status
  ON strategy_runs (status, mode)
  WHERE status IN ('pending', 'running');
