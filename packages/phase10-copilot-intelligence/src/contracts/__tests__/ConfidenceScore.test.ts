import {
  bandForScore,
  assertValidWeights,
  isPlaceholderRiskContext,
  CONFIDENCE_BAND_THRESHOLDS,
  ConfidenceScore,
  ConfidenceFactorWeight,
  ExternalMarketRiskContext,
} from '../ConfidenceScore';

describe('bandForScore', () => {
  it('maps exact threshold boundaries to the correct band', () => {
    expect(bandForScore(80)).toBe('very_high');
    expect(bandForScore(60)).toBe('high');
    expect(bandForScore(40)).toBe('moderate');
    expect(bandForScore(20)).toBe('low');
    expect(bandForScore(0)).toBe('very_low');
  });

  it('maps just-below-threshold scores to the lower band', () => {
    expect(bandForScore(79.9)).toBe('high');
    expect(bandForScore(59.9)).toBe('moderate');
    expect(bandForScore(39.9)).toBe('low');
    expect(bandForScore(19.9)).toBe('very_low');
  });

  it('clamps out-of-range scores instead of throwing', () => {
    expect(bandForScore(150)).toBe('very_high');
    expect(bandForScore(-50)).toBe('very_low');
  });

  it('every declared threshold is reachable and ordered high-to-low', () => {
    const mins = CONFIDENCE_BAND_THRESHOLDS.map((t) => t.min);
    const sorted = [...mins].sort((a, b) => b - a);
    expect(mins).toEqual(sorted);
  });
});

describe('assertValidWeights', () => {
  it('passes when weights sum to 1.0', () => {
    const weights: ConfidenceFactorWeight[] = [
      { factorId: 'signal_strength', weight: 0.5 },
      { factorId: 'regime_alignment', weight: 0.5 },
    ];
    expect(() => assertValidWeights(weights)).not.toThrow();
  });

  it('passes within floating point tolerance', () => {
    const weights: ConfidenceFactorWeight[] = [
      { factorId: 'a', weight: 0.1 },
      { factorId: 'b', weight: 0.2 },
      { factorId: 'c', weight: 0.7 },
    ];
    expect(() => assertValidWeights(weights)).not.toThrow();
  });

  it('throws with a descriptive message when weights do not sum to 1.0', () => {
    const weights: ConfidenceFactorWeight[] = [
      { factorId: 'signal_strength', weight: 0.5 },
      { factorId: 'regime_alignment', weight: 0.3 },
    ];
    expect(() => assertValidWeights(weights)).toThrow(/must sum to 1.0/);
    expect(() => assertValidWeights(weights)).toThrow(/signal_strength=0.5/);
  });
});

describe('isPlaceholderRiskContext', () => {
  it('returns true for a Phase 6 placeholder context', () => {
    const ctx: ExternalMarketRiskContext = {
      riskLevel: 'medium',
      volatilityPercentile: 55,
      source: 'PHASE_6_PLACEHOLDER',
    };
    expect(isPlaceholderRiskContext(ctx)).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(isPlaceholderRiskContext(undefined)).toBe(false);
  });
});

describe('ConfidenceScore shape (compile-time contract check)', () => {
  it('accepts a fully-formed score object', () => {
    const score: ConfidenceScore = {
      score: 72,
      band: bandForScore(72),
      factors: [
        {
          factorId: 'signal_strength',
          rawScore: 80,
          weight: 0.6,
          contribution: 48,
          rationale: 'Strong breakout signal on daily timeframe',
        },
        {
          factorId: 'regime_alignment',
          rawScore: 60,
          weight: 0.4,
          contribution: 24,
          rationale: 'Regime trending_up partially aligned with strategy bias',
        },
      ],
      computedAt: new Date().toISOString(),
      strategyId: 'strat-001',
      symbol: 'RELIANCE',
      schemaVersion: 1,
    };
    expect(score.score).toBe(72);
    expect(score.band).toBe('high');
  });
});
