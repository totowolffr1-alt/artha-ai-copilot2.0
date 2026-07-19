/**
 * packages/phase6-tradingview/src/__tests__/RiskEngine.test.ts
 * Artha AI — Phase 6 Risk Engine unit tests
 */

import { NiftyTrendAnalyser } from '../market/indices/NiftyTrendAnalyser';
import { BankNiftyTrendAnalyser } from '../market/indices/BankNiftyTrendAnalyser';
import { VIXAnalyser } from '../market/vix/VIXAnalyser';
import { MarketRegimeAggregator } from '../market/regime/MarketRegimeAggregator';
import { ConvictionScorer } from '../sizer/ConvictionScorer';
import { PositionSizer } from '../sizer/PositionSizer';
import { ExposureManager } from '../exposure/ExposureManager';
import { SectorMapper } from '../exposure/SectorMapper';
import { DrawdownTracker } from '../drawdown/DrawdownTracker';
import { VolatilityAnalyser } from '../volatility/VolatilityAnalyser';
import { RegimeFilter } from '../regime/RegimeFilter';
import { LiquidityChecker } from '../liquidity/LiquidityChecker';
import { MarketStatusChecker } from '../market_status/MarketStatusChecker';
import { OvernightGapRiskChecker } from '../gap/OvernightGapRiskChecker';
import { CircuitBreaker } from '../breaker/CircuitBreaker';
import { PortfolioVaR } from '../var/PortfolioVaR';
import { MarketRiskConfig, PortfolioSnapshot, SwingRiskConfig } from '../types';

const BASE_CFG: MarketRiskConfig = {
  weight_nifty: 0.35,
  weight_banknifty: 0.25,
  weight_regime: 0.25,
  weight_vix: 0.15,
  crash_nifty_dd_threshold: 0.15,
  banknifty_divergence_threshold: 0.40,
  banknifty_lag_cap: 0.70,
  vix_extreme_threshold: 35.0,
  vix_spike_ratio_threshold: 1.40,
  vix_spike_cache_invalidation_ratio: 1.25,
  multiplier_strong_bull: 1.00,
  multiplier_bull: 0.85,
  multiplier_neutral: 0.70,
  multiplier_caution: 0.50,
  multiplier_bear: 0.30,
  multiplier_high_volatility: 0.40,
  market_context_refresh_interval_minutes: 15,
};

const SWING_CFG: SwingRiskConfig = {
  earnings_gap_low_threshold_pct: 3.0,
  earnings_gap_medium_threshold_pct: 6.0,
  earnings_gap_high_threshold_pct: 10.0,
  earnings_gap_min_observations: 3,
  gap_history_lookback_days: 252,
  gap_significant_threshold_pct: 2.0,
  gap_sigma_multiplier: 1.65,
  overnight_fraction: 0.40,
  gap_weight_historical: 0.40,
  gap_weight_p95: 0.35,
  gap_weight_vix: 0.25,
  gap_medium_size_multiplier: 0.85,
  gap_high_size_multiplier: 0.60,
  block_on_fno_ban: true,
  block_on_sebi_investigation: true,
  sebi_investigation_multiplier: 0.50,
  gsm_block_stage: 5,
  news_impact_medium_multiplier: 0.75,
  news_impact_high_multiplier: 0.50,
};

const EMPTY_PORTFOLIO: PortfolioSnapshot = {
  cash_available: 1_000_000,
  total_portfolio_value: 1_000_000,
  margin_used: 0,
  positions: [],
  open_trade_count: 0,
  peak_value: 1_000_000,
};

// ── NiftyTrendAnalyser ────────────────────────────────────────────────────────

describe('NiftyTrendAnalyser', () => {
  const analyser = new NiftyTrendAnalyser();

  it('returns bull_full score close to +1 when fully aligned', () => {
    const result = analyser.analyse({
      price: 25000, ema20: 24500, ema50: 24000, ema200: 23000, peak_52w: 25200,
    });
    expect(result.alignment).toBe('bull_full');
    expect(result.score).toBeGreaterThan(0.5);
  });

  it('returns bear_full score close to -1 when fully inverted', () => {
    const result = analyser.analyse({
      price: 19000, ema20: 20000, ema50: 21000, ema200: 22000, peak_52w: 25000,
    });
    expect(result.alignment).toBe('bear_full');
    expect(result.score).toBeLessThan(-0.5);
  });

  it('applies drawdown penalty when price is >15% below 52w peak', () => {
    const bullResult = analyser.analyse({
      price: 22000, ema20: 21500, ema50: 21000, ema200: 20000, peak_52w: 26000,
    });
    expect(bullResult.dd_from_peak_pct).toBeGreaterThan(0.15);
    // Score should be penalised
    expect(bullResult.score).toBeLessThanOrEqual(0.7);
  });
});

// ── VIXAnalyser ───────────────────────────────────────────────────────────────

describe('VIXAnalyser', () => {
  const analyser = new VIXAnalyser();

  it('sets crash_signal=true when VIX > 35', () => {
    const result = analyser.analyse({ vix_current: 40, vix_20d_avg: 18, extreme_threshold: 35, spike_ratio_threshold: 1.40 });
    expect(result.crash_signal).toBe(true);
    expect(result.score).toBeCloseTo(1.0);
  });

  it('detects spike when ratio > threshold', () => {
    const result = analyser.analyse({ vix_current: 28, vix_20d_avg: 15, extreme_threshold: 35, spike_ratio_threshold: 1.40 });
    expect(result.spike_detected).toBe(true);
    expect(result.score).toBeGreaterThan(0.60);
  });

  it('returns CALM tier for VIX below 14', () => {
    const result = analyser.analyse({ vix_current: 12, vix_20d_avg: 13, extreme_threshold: 35, spike_ratio_threshold: 1.40 });
    expect(result.level_tier).toBe('CALM');
    expect(result.score).toBe(0);
  });
});

// ── MarketRegimeAggregator ────────────────────────────────────────────────────

describe('MarketRegimeAggregator', () => {
  const aggregator = new MarketRegimeAggregator();
  const baseInputs = {
    nifty_price: 24000, nifty_ema20: 23500, nifty_ema50: 23000,
    nifty_ema200: 22000, banknifty_price: 52000, banknifty_ema20: 51000,
    vix_current: 14, vix_20d_avg: 14,
  };

  it('returns CRASH with hard_block=true when VIX > 35', () => {
    const result = aggregator.aggregate(
      { ...baseInputs, nifty_score: 0.8, banknifty_score: 0.6, vix_score: 1.0,
        regime_label: 'trending_up', vix_crash: true,
        nifty_dd_from_peak_pct: 0.05, banknifty_divergence: false },
      BASE_CFG, new Date()
    );
    expect(result.hard_block).toBe(true);
    expect(result.market_state).toBe('CRASH');
  });

  it('returns STRONG_BULL with multiplier=1.00 on fully bullish inputs', () => {
    const result = aggregator.aggregate(
      { ...baseInputs, nifty_score: 1.0, banknifty_score: 1.0, vix_score: 0,
        regime_label: 'strong_trend', vix_crash: false,
        nifty_dd_from_peak_pct: 0.02, banknifty_divergence: false },
      BASE_CFG, new Date()
    );
    expect(result.market_state).toBe('STRONG_BULL');
    expect(result.risk_budget_multiplier).toBeCloseTo(1.0);
  });
});

// ── ConvictionScorer ──────────────────────────────────────────────────────────

describe('ConvictionScorer', () => {
  const scorer = new ConvictionScorer();

  it('returns high conviction for strong signal with tight spread', () => {
    const result = scorer.score({ strength: 0.9, kelly_fraction: 0.8, regime_confidence: 0.85, spread_pct: 0.05 });
    expect(result.conviction).toBeGreaterThan(0.75);
  });

  it('applies spread penalty for wide spread', () => {
    const tight = scorer.score({ strength: 0.9, kelly_fraction: 0.8, regime_confidence: 0.85, spread_pct: 0.05 });
    const wide  = scorer.score({ strength: 0.9, kelly_fraction: 0.8, regime_confidence: 0.85, spread_pct: 0.60 });
    expect(wide.conviction).toBeLessThan(tight.conviction);
  });
});

// ── PositionSizer ─────────────────────────────────────────────────────────────

describe('PositionSizer', () => {
  const sizer = new PositionSizer();

  it('returns zero qty when capital is zero', () => {
    const result = sizer.size({
      available_capital: 0, entry_price: 1000, stop_loss: 950,
      atr: 20, atr_fallback_multiplier: 2, kelly_fraction: 0.5,
      conviction: 0.8, max_risk_per_trade_pct: 0.01,
      max_capital_per_trade_pct: 0.10, risk_budget_multiplier: 1.0, min_tradeable_qty: 1,
    });
    expect(result.qty).toBe(0);
  });

  it('uses ATR fallback when stop_loss is null', () => {
    const result = sizer.size({
      available_capital: 1_000_000, entry_price: 1000, stop_loss: null,
      atr: 25, atr_fallback_multiplier: 2, kelly_fraction: 0.3,
      conviction: 0.7, max_risk_per_trade_pct: 0.01,
      max_capital_per_trade_pct: 0.10, risk_budget_multiplier: 1.0, min_tradeable_qty: 1,
    });
    expect(result.effective_sl_distance).toBe(50);
    expect(result.qty).toBeGreaterThan(0);
  });

  it('respects capital cap', () => {
    const result = sizer.size({
      available_capital: 1_000_000, entry_price: 500, stop_loss: 490,
      atr: 10, atr_fallback_multiplier: 2, kelly_fraction: 1.0,
      conviction: 1.0, max_risk_per_trade_pct: 0.05,
      max_capital_per_trade_pct: 0.10, risk_budget_multiplier: 1.0, min_tradeable_qty: 1,
    });
    expect(result.capital_allocated).toBeLessThanOrEqual(100_000);
  });
});

// ── DrawdownTracker ───────────────────────────────────────────────────────────

describe('DrawdownTracker', () => {
  it('detects daily drawdown breach', () => {
    const tracker = new DrawdownTracker();
    tracker.initialize(100_000);
    tracker.onEquityUpdate(98_000);  // 2% DD

    const check = tracker.validate(0.015, 0.05, 0.08, 1.0);  // 1.5% daily limit
    expect(check.passed).toBe(false);
    expect(check.breached_horizon).toBe('daily');
  });

  it('passes when DD is within limits', () => {
    const tracker = new DrawdownTracker();
    tracker.initialize(100_000);
    tracker.onEquityUpdate(99_500);  // 0.5% DD

    const check = tracker.validate(0.02, 0.05, 0.08, 1.0);
    expect(check.passed).toBe(true);
  });

  it('multiplier tightens the limit', () => {
    const tracker = new DrawdownTracker();
    tracker.initialize(100_000);
    tracker.onEquityUpdate(98_500);  // 1.5% DD

    // With 0.5 multiplier, effective limit = 2% × 0.5 = 1% → breach
    const check = tracker.validate(0.02, 0.05, 0.08, 0.5);
    expect(check.passed).toBe(false);
  });
});

// ── RegimeFilter ──────────────────────────────────────────────────────────────

describe('RegimeFilter', () => {
  const filter = new RegimeFilter();

  it('rejects LONG in BEAR state', () => {
    const result = filter.filter('LONG', 'BEAR');
    expect(result.passed).toBe(false);
  });

  it('rejects LONG in CRASH state', () => {
    const result = filter.filter('LONG', 'CRASH');
    expect(result.passed).toBe(false);
  });

  it('reduces size by 50% in HIGH_VOLATILITY', () => {
    const result = filter.filter('LONG', 'HIGH_VOLATILITY');
    expect(result.passed).toBe(true);
    expect(result.size_multiplier).toBe(0.5);
  });

  it('allows LONG in STRONG_BULL', () => {
    const result = filter.filter('LONG', 'STRONG_BULL');
    expect(result.passed).toBe(true);
    expect(result.size_multiplier).toBe(1.0);
  });
});

// ── MarketStatusChecker ───────────────────────────────────────────────────────

describe('MarketStatusChecker', () => {
  it('blocks F&O banned symbol', () => {
    const checker = new MarketStatusChecker();
    checker.hydrate('sym-1', { fno_banned: true, surveillance_stage: 'NONE', t2t: false });
    const result = checker.check('sym-1', SWING_CFG);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('fno_ban_active');
  });

  it('blocks SEBI trading restriction', () => {
    const checker = new MarketStatusChecker();
    checker.hydrate('sym-2', { fno_banned: false, sebi_action_type: 'TRADING_RESTRICTION', surveillance_stage: 'NONE', t2t: false });
    const result = checker.check('sym-2', SWING_CFG);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('sebi_trading_restriction');
  });

  it('blocks GSM Stage 5+', () => {
    const checker = new MarketStatusChecker();
    checker.hydrate('sym-3', { fno_banned: false, surveillance_stage: 'GSM_5', t2t: false });
    const result = checker.check('sym-3', SWING_CFG);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('gsm_stage_high');
  });

  it('passes clean symbol', () => {
    const checker = new MarketStatusChecker();
    const result = checker.check('sym-clean', SWING_CFG);
    expect(result.passed).toBe(true);
  });
});

// ── CircuitBreaker ────────────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  it('starts ARMED', () => {
    const cb = new CircuitBreaker();
    expect(cb.isArmed()).toBe(true);
  });

  it('trips and blocks', () => {
    const cb = new CircuitBreaker();
    cb.trip('Daily DD limit hit');
    expect(cb.isArmed()).toBe(false);
    expect(cb.getStatus().state).toBe('TRIPPED');
  });

  it('can be reset', () => {
    const cb = new CircuitBreaker();
    cb.trip('test');
    cb.reset();
    expect(cb.isArmed()).toBe(true);
  });
});

// ── OvernightGapRiskChecker ───────────────────────────────────────────────────

describe('OvernightGapRiskChecker', () => {
  it('returns EXTREME tier and blocks for high gap risk symbols', () => {
    const checker = new OvernightGapRiskChecker();
    checker.hydrate([{
      symbol_id: 'volatile-sym',
      gap_frequency_pct: 0.80,
      median_gap_magnitude_pct: 0.08,
      p95_gap_magnitude_pct: 0.18,
      gap_observations: 50,
      beta: 1.5,
    }]);
    const result = checker.check('volatile-sym', 5, 30, SWING_CFG);
    expect(result.metrics.risk_tier).toBe('EXTREME');
    expect(result.passed).toBe(false);
  });

  it('passes and is not HIGH/EXTREME for low volatility symbols', () => {
    const checker = new OvernightGapRiskChecker();
    checker.hydrate([{
      symbol_id: 'stable-sym',
      gap_frequency_pct: 0.02,
      median_gap_magnitude_pct: 0.003,
      p95_gap_magnitude_pct: 0.008,
      gap_observations: 200,
      beta: 0.5,
    }]);
    const result = checker.check('stable-sym', 1, 12, SWING_CFG);
    expect(result.passed).toBe(true);
    // VIX component (vix/100 × weight_vix) at vix=12 pushes score to MEDIUM boundary
    // What matters for stable symbols is NOT being HIGH or EXTREME
    expect(['LOW', 'MEDIUM']).toContain(result.metrics.risk_tier);
    expect(result.metrics.gap_risk_score).toBeLessThan(0.06);
  });
});
