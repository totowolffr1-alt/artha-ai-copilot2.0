import { ConvictionEngine, MIN_SAMPLE_SIZE_FOR_HISTORY } from '../ConvictionEngine';
import {
  ConfidenceScoreInput,
  ExternalMarketRiskContext,
  ExternalHistoricalPerformanceStats,
} from '../../contracts';

describe('ConvictionEngine — base profile (signal + regime only)', () => {
  const engine = new ConvictionEngine();

  it('computes weighted score with 60/40 split', () => {
    const input: ConfidenceScoreInput = {
      strategyId: 'strat-001',
      symbol: 'RELIANCE',
      signalStrength: 80,
      regimeAlignment: 60,
    };
    const result = engine.calculate(input);
    // 80*0.6 + 60*0.4 = 48 + 24 = 72
    expect(result.score).toBe(72);
    expect(result.band).toBe('high');
    expect(result.factors).toHaveLength(2);
    expect(result.schemaVersion).toBe(1);
    expect(result.strategyId).toBe('strat-001');
    expect(result.symbol).toBe('RELIANCE');
  });

  it('produces rationale strings for each factor', () => {
    const result = engine.calculate({
      strategyId: 's1',
      symbol: 'TCS',
      signalStrength: 50,
      regimeAlignment: 50,
    });
    result.factors.forEach((f) => {
      expect(f.rationale.length).toBeGreaterThan(0);
    });
  });

  it('handles extreme low scores correctly', () => {
    const result = engine.calculate({
      strategyId: 's1',
      symbol: 'INFY',
      signalStrength: 0,
      regimeAlignment: 0,
    });
    expect(result.score).toBe(0);
    expect(result.band).toBe('very_low');
  });
});

describe('ConvictionEngine — risk profile', () => {
  const engine = new ConvictionEngine();

  it('reweights to include risk_penalty factor when risk context present', () => {
    const riskContext: ExternalMarketRiskContext = {
      riskLevel: 'high',
      volatilityPercentile: 70,
      source: 'PHASE_6_PLACEHOLDER',
    };
    const result = engine.calculate({
      strategyId: 's1',
      symbol: 'HDFCBANK',
      signalStrength: 80,
      regimeAlignment: 80,
      marketRiskContext: riskContext,
    });
    expect(result.factors.map((f) => f.factorId)).toEqual([
      'signal_strength',
      'regime_alignment',
      'risk_penalty',
    ]);
    // high risk (base 35) - 70*0.2=14 => rawScore 21
    const riskFactor = result.factors.find((f) => f.factorId === 'risk_penalty')!;
    expect(riskFactor.rawScore).toBe(21);
  });

  it('flags placeholder risk data in rationale', () => {
    const result = engine.calculate({
      strategyId: 's1',
      symbol: 'HDFCBANK',
      signalStrength: 50,
      regimeAlignment: 50,
      marketRiskContext: { riskLevel: 'low', volatilityPercentile: 10, source: 'PHASE_6_PLACEHOLDER' },
    });
    const riskFactor = result.factors.find((f) => f.factorId === 'risk_penalty')!;
    expect(riskFactor.rationale).toMatch(/Phase 6 risk engine not yet implemented/);
  });
});

describe('ConvictionEngine — historical stats profile', () => {
  const engine = new ConvictionEngine();

  it('includes historical_track_record when sample size clears cold-start floor', () => {
    const stats: ExternalHistoricalPerformanceStats = {
      winRate: 65,
      sampleSize: MIN_SAMPLE_SIZE_FOR_HISTORY,
      source: 'PHASE_8_PLACEHOLDER',
    };
    const result = engine.calculate({
      strategyId: 's1',
      symbol: 'ITC',
      signalStrength: 60,
      regimeAlignment: 60,
      historicalStats: stats,
    });
    expect(result.factors.map((f) => f.factorId)).toContain('historical_track_record');
  });

  it('ignores historical stats below the cold-start sample size floor', () => {
    const stats: ExternalHistoricalPerformanceStats = {
      winRate: 95,
      sampleSize: MIN_SAMPLE_SIZE_FOR_HISTORY - 1,
      source: 'PHASE_8_PLACEHOLDER',
    };
    const result = engine.calculate({
      strategyId: 's1',
      symbol: 'ITC',
      signalStrength: 60,
      regimeAlignment: 60,
      historicalStats: stats,
    });
    expect(result.factors.map((f) => f.factorId)).not.toContain('historical_track_record');
    expect(result.factors).toHaveLength(2); // fell back to base profile
  });
});

describe('ConvictionEngine — combined risk + history profile', () => {
  const engine = new ConvictionEngine();

  it('uses all four factors when both optional contexts are usable', () => {
    const result = engine.calculate({
      strategyId: 's1',
      symbol: 'SBIN',
      signalStrength: 70,
      regimeAlignment: 70,
      marketRiskContext: { riskLevel: 'medium', volatilityPercentile: 40, source: 'PHASE_6_PLACEHOLDER' },
      historicalStats: { winRate: 55, sampleSize: 30, source: 'PHASE_8_PLACEHOLDER' },
    });
    expect(result.factors).toHaveLength(4);
    const totalWeight = result.factors.reduce((acc, f) => acc + f.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 6);
  });
});

describe('ConvictionEngine — input validation', () => {
  const engine = new ConvictionEngine();

  it('throws on empty strategyId', () => {
    expect(() =>
      engine.calculate({ strategyId: '', symbol: 'TCS', signalStrength: 50, regimeAlignment: 50 })
    ).toThrow(/strategyId is required/);
  });

  it('throws on empty symbol', () => {
    expect(() =>
      engine.calculate({ strategyId: 's1', symbol: '', signalStrength: 50, regimeAlignment: 50 })
    ).toThrow(/symbol is required/);
  });

  it('throws on out-of-range signalStrength', () => {
    expect(() =>
      engine.calculate({ strategyId: 's1', symbol: 'TCS', signalStrength: 150, regimeAlignment: 50 })
    ).toThrow(/signalStrength must be a number in range 0..100/);
  });

  it('throws on negative regimeAlignment', () => {
    expect(() =>
      engine.calculate({ strategyId: 's1', symbol: 'TCS', signalStrength: 50, regimeAlignment: -10 })
    ).toThrow(/regimeAlignment must be a number in range 0..100/);
  });

  it('throws on NaN input', () => {
    expect(() =>
      engine.calculate({ strategyId: 's1', symbol: 'TCS', signalStrength: NaN, regimeAlignment: 50 })
    ).toThrow(/signalStrength must be a number in range 0..100/);
  });

  it('throws on negative sampleSize', () => {
    expect(() =>
      engine.calculate({
        strategyId: 's1',
        symbol: 'TCS',
        signalStrength: 50,
        regimeAlignment: 50,
        historicalStats: { winRate: 50, sampleSize: -5, source: 'PHASE_8_PLACEHOLDER' },
      })
    ).toThrow(/sampleSize cannot be negative/);
  });
});
