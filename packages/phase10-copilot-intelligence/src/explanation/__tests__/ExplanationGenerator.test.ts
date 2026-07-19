import { ExplanationGenerator } from '../ExplanationGenerator';
import { ConvictionEngine } from '../../conviction/ConvictionEngine';
import { ConfidenceScore } from '../../contracts';

function buildScore(): ConfidenceScore {
  return {
    score: 72,
    band: 'high',
    factors: [
      {
        factorId: 'signal_strength',
        rawScore: 80,
        weight: 0.6,
        contribution: 48,
        rationale: 'Signal engine reported strength 80.0/100',
      },
      {
        factorId: 'regime_alignment',
        rawScore: 60,
        weight: 0.4,
        contribution: 24,
        rationale: 'Regime alignment scored 60.0/100 against strategy bias',
      },
    ],
    computedAt: new Date().toISOString(),
    strategyId: 'strat-001',
    symbol: 'RELIANCE',
    schemaVersion: 1,
  };
}

describe('ExplanationGenerator — basic generation', () => {
  const generator = new ExplanationGenerator();

  it('produces a one-line summary with score, band label, and symbol', () => {
    const explanation = generator.generate(buildScore());
    expect(explanation.summary).toBe('72/100 — High confidence for RELIANCE');
  });

  it('ranks factors by absolute contribution, largest first', () => {
    const explanation = generator.generate(buildScore());
    expect(explanation.factorNarratives[0].factorId).toBe('signal_strength');
    expect(explanation.factorNarratives[0].rank).toBe(1);
    expect(explanation.factorNarratives[1].factorId).toBe('regime_alignment');
    expect(explanation.factorNarratives[1].rank).toBe(2);
  });

  it('labels rank 1 as Primary driver and rank 2 as Secondary factor', () => {
    const explanation = generator.generate(buildScore());
    expect(explanation.factorNarratives[0].text).toMatch(/^Primary driver:/);
    expect(explanation.factorNarratives[1].text).toMatch(/^Secondary factor:/);
  });

  it('carries strategyId, symbol, and schemaVersion through from the score', () => {
    const explanation = generator.generate(buildScore());
    expect(explanation.strategyId).toBe('strat-001');
    expect(explanation.symbol).toBe('RELIANCE');
    expect(explanation.schemaVersion).toBe(1);
  });

  it('returns no placeholder disclosures when no factor rationale is placeholder-backed', () => {
    const explanation = generator.generate(buildScore());
    expect(explanation.placeholderDisclosures).toHaveLength(0);
  });

  it('throws if the score has no factors', () => {
    const empty: ConfidenceScore = { ...buildScore(), factors: [] };
    expect(() => generator.generate(empty)).toThrow(/must contain at least one factor/);
  });
});

describe('ExplanationGenerator — concise vs detailed tone', () => {
  const generator = new ExplanationGenerator();

  it('concise tone omits full rationale text', () => {
    const explanation = generator.generate(buildScore(), 'concise');
    expect(explanation.factorNarratives[0].text).toBe('Primary driver: signal strength (80/100)');
  });

  it('detailed tone (default) includes full rationale and contribution points', () => {
    const explanation = generator.generate(buildScore(), 'detailed');
    expect(explanation.factorNarratives[0].text).toContain('Signal engine reported strength 80.0/100');
    expect(explanation.factorNarratives[0].text).toContain('contributed 48.0 points at weight 0.6');
  });
});

describe('ExplanationGenerator — placeholder disclosure surfacing (integration with ConvictionEngine)', () => {
  it('surfaces Phase 6 placeholder risk data as a disclosure', () => {
    const engine = new ConvictionEngine();
    const score = engine.calculate({
      strategyId: 's1',
      symbol: 'HDFCBANK',
      signalStrength: 70,
      regimeAlignment: 70,
      marketRiskContext: { riskLevel: 'medium', volatilityPercentile: 40, source: 'PHASE_6_PLACEHOLDER' },
    });
    const generator = new ExplanationGenerator();
    const explanation = generator.generate(score);
    expect(explanation.placeholderDisclosures.length).toBeGreaterThan(0);
    expect(explanation.placeholderDisclosures[0]).toMatch(/Phase 6 risk engine not yet implemented/);
  });

  it('surfaces Phase 8 placeholder historical data as a disclosure', () => {
    const engine = new ConvictionEngine();
    const score = engine.calculate({
      strategyId: 's1',
      symbol: 'ITC',
      signalStrength: 60,
      regimeAlignment: 60,
      historicalStats: { winRate: 65, sampleSize: 25, source: 'PHASE_8_PLACEHOLDER' },
    });
    const generator = new ExplanationGenerator();
    const explanation = generator.generate(score);
    expect(explanation.placeholderDisclosures.length).toBeGreaterThan(0);
    expect(explanation.placeholderDisclosures[0]).toMatch(/Phase 8 learning engine stats surface not yet stable/);
  });

  it('produces no disclosures for a pure base-profile score (no external context)', () => {
    const engine = new ConvictionEngine();
    const score = engine.calculate({
      strategyId: 's1',
      symbol: 'TCS',
      signalStrength: 55,
      regimeAlignment: 55,
    });
    const generator = new ExplanationGenerator();
    const explanation = generator.generate(score);
    expect(explanation.placeholderDisclosures).toHaveLength(0);
  });
});
