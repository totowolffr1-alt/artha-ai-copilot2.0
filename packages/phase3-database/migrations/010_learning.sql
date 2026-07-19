-- ============================================================
-- 010_learning.sql
-- Artha AI — Phase 3E
-- Tables: learning_records, strategy_performance,
--         indicator_performance, regime_performance
-- Depends on: symbols (004), trades (007), signals (007), strategy_runs (006)
-- ============================================================

-- ─── learning_records ─────────────────────────────────────────────────────────
-- Immutable raw training corpus. One row per closed trade.
-- Written atomically on trade close (same transaction). Never updated.

CREATE TABLE learning_records (
  record_id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id           uuid          NOT NULL UNIQUE REFERENCES trades (trade_id),
  signal_id          uuid          REFERENCES signals (signal_id),
  symbol_id          uuid          NOT NULL REFERENCES symbols (symbol_id),  -- denormalised
  regime             varchar(30)   NOT NULL,
  features_at_entry  jsonb         NOT NULL,   -- Full feature vector at entry; never mutated
  features_at_exit   jsonb,
  predicted_return   numeric(10,6),            -- NULL if strategy doesn't predict
  actual_return      numeric(10,6) NOT NULL,   -- Direction-signed fraction
  prediction_error   numeric(10,6),            -- actual - predicted
  entry_price        numeric(12,2) NOT NULL,
  exit_price         numeric(12,2) NOT NULL,
  realised_pnl       numeric(14,2) NOT NULL,   -- Net after commission + slippage
  mae                numeric(10,6) NOT NULL,   -- Max adverse excursion as entry fraction
  mfe                numeric(10,6) NOT NULL,   -- Max favourable excursion as entry fraction
  holding_bars       int           NOT NULL,   -- Duration in primary-timeframe bars
  was_winner         boolean       NOT NULL,   -- realised_pnl > 0
  kelly_used         numeric(6,4),             -- signals.kelly_fraction at fire time
  kelly_optimal      numeric(6,4),             -- Post-hoc optimal Kelly
  trade_opened_at    timestamptz   NOT NULL,
  trade_closed_at    timestamptz   NOT NULL,
  recorded_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_learning_symbol_closed
  ON learning_records (symbol_id, trade_closed_at DESC);

CREATE INDEX idx_learning_regime
  ON learning_records (regime, trade_closed_at DESC);

CREATE INDEX idx_learning_winner_regime
  ON learning_records (was_winner, regime);

CREATE INDEX idx_learning_pred_error
  ON learning_records (prediction_error)
  WHERE prediction_error IS NOT NULL;

-- ─── strategy_performance ─────────────────────────────────────────────────────
-- Aggregated win/loss stats per strategy run, sliced by regime.
-- Signal engine reads regime_fitness for regime-conditional strategy weighting.

CREATE TABLE strategy_performance (
  perf_id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_run_id       uuid          NOT NULL REFERENCES strategy_runs (strategy_run_id),
  symbol_id             uuid          REFERENCES symbols (symbol_id),  -- NULL = cross-symbol
  regime                varchar(30)   NOT NULL,   -- 'all' = regime-agnostic
  period_start          date          NOT NULL,
  period_end            date          NOT NULL,
  period_type           varchar(10)   NOT NULL,
  total_signals         int           NOT NULL DEFAULT 0,
  acted_signals         int           NOT NULL DEFAULT 0,
  winning_trades        int           NOT NULL DEFAULT 0,
  losing_trades         int           NOT NULL DEFAULT 0,
  win_rate              numeric(6,4)  NOT NULL DEFAULT 0,
  avg_return_pct        numeric(10,4),
  avg_mae               numeric(10,6),
  avg_mfe               numeric(10,6),
  avg_holding_bars      numeric(8,2),
  sharpe_ratio          numeric(8,4),            -- NULL if <30 trades
  profit_factor         numeric(8,4),            -- NULL if no losses
  kelly_accuracy        numeric(6,4),            -- Correlation: kelly_used vs kelly_optimal
  avg_prediction_error  numeric(10,6),
  regime_fitness        numeric(8,4),            -- Composite 0-1; signal engine weighting key
  computed_at           timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_strategy_perf UNIQUE (strategy_run_id, symbol_id, regime, period_type, period_start)
);

CREATE INDEX idx_strat_perf_run_regime
  ON strategy_performance (strategy_run_id, regime, period_type);

CREATE INDEX idx_strat_perf_fitness
  ON strategy_performance (regime_fitness DESC)
  WHERE regime_fitness IS NOT NULL;

CREATE INDEX idx_strat_perf_symbol_regime
  ON strategy_performance (symbol_id, regime, period_end DESC)
  WHERE symbol_id IS NOT NULL;

-- ─── indicator_performance ─────────────────────────────────────────────────────
-- Predictive contribution of each indicator. Signal engine reads information_ratio
-- to prune or re-weight indicators.

CREATE TABLE indicator_performance (
  indicator_perf_id    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_run_id      uuid          NOT NULL REFERENCES strategy_runs (strategy_run_id),
  indicator_name       varchar(50)   NOT NULL,
  indicator_params     varchar(200)  NOT NULL,  -- e.g. 'period=14,src=close'
  regime               varchar(30)   NOT NULL,  -- 'all' = regime-agnostic
  symbol_class         varchar(20)   NOT NULL,  -- equity, futures, options, index
  period_start         date          NOT NULL,
  period_end           date          NOT NULL,
  predictive_accuracy  numeric(6,4),            -- 0.5 = random
  signal_contribution  numeric(8,4),            -- Partial correlation with actual_return
  avg_lead_bars        numeric(6,2),
  false_positive_rate  numeric(6,4),
  false_negative_rate  numeric(6,4),
  information_ratio    numeric(8,4),            -- Primary pruning metric
  sample_count         int           NOT NULL DEFAULT 0,
  computed_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_indicator_perf
    UNIQUE (strategy_run_id, indicator_name, indicator_params, regime, symbol_class, period_start)
);

CREATE INDEX idx_indicator_name_regime
  ON indicator_performance (indicator_name, regime, period_end DESC);

CREATE INDEX idx_indicator_run_ir
  ON indicator_performance (strategy_run_id, information_ratio DESC);

CREATE INDEX idx_indicator_regime_class
  ON indicator_performance (regime, symbol_class, predictive_accuracy DESC);

-- ─── regime_performance ───────────────────────────────────────────────────────
-- Characterises each regime label. Regime detector reads indicator_rankings
-- to select features for next classification pass.

CREATE TABLE regime_performance (
  regime_perf_id     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id          uuid          REFERENCES symbols (symbol_id),  -- NULL = market-wide
  regime             varchar(30)   NOT NULL,
  timeframe          varchar(5)    NOT NULL,
  period_start       date          NOT NULL,
  period_end         date          NOT NULL,
  occurrence_count   int           NOT NULL DEFAULT 0,
  avg_duration_bars  numeric(8,2),
  avg_return_pct     numeric(10,4),
  win_rate           numeric(6,4),
  best_strategy      varchar(100),  -- strategy_run_id with highest regime_fitness
  worst_strategy     varchar(100),
  avg_volatility     numeric(10,6), -- Mean ATR fraction during regime
  avg_volume_ratio   numeric(8,4),  -- Mean volume vs 20-bar average
  indicator_rankings jsonb         NOT NULL DEFAULT '[]',  -- [{indicator_name, params, information_ratio}]
  computed_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_regime_perf UNIQUE (symbol_id, regime, timeframe, period_start)
);

CREATE INDEX idx_regime_perf_tf
  ON regime_performance (regime, timeframe, period_end DESC);

CREATE INDEX idx_regime_perf_symbol
  ON regime_performance (symbol_id, regime, timeframe)
  WHERE symbol_id IS NOT NULL;

CREATE INDEX idx_regime_perf_win_rate
  ON regime_performance (win_rate DESC, regime);
