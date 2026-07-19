import { PortfolioAnalyzer } from '../PortfolioAnalyzer';
import { Portfolio, ClosedTrade } from '../../contracts';

function buildConcentratedPortfolio(): Portfolio {
  // Two positions: one dominant (80% of value), one small (20%).
  // Total position value = 8000 + 2000 = 10000, cash = 0 -> totalValue = 10000
  return {
    positions: [
      { symbol: 'RELIANCE', instrumentType: 'EQUITY', quantity: 10, avgEntryPrice: 700, currentPrice: 800 }, // value 8000
      { symbol: 'TCS', instrumentType: 'EQUITY', quantity: 5, avgEntryPrice: 400, currentPrice: 400 }, // value 2000
    ],
    cashBalance: 0,
    asOf: new Date().toISOString(),
  };
}

function buildDiversifiedPortfolio(): Portfolio {
  // Four equal-weight positions, 25% each, with cash for a realistic deployed%.
  return {
    positions: [
      { symbol: 'A', instrumentType: 'EQUITY', quantity: 10, avgEntryPrice: 100, currentPrice: 100, sector: 'IT' }, // 1000
      { symbol: 'B', instrumentType: 'EQUITY', quantity: 10, avgEntryPrice: 100, currentPrice: 100, sector: 'BANKING' }, // 1000
      { symbol: 'C', instrumentType: 'EQUITY', quantity: 10, avgEntryPrice: 100, currentPrice: 100, sector: 'ENERGY' }, // 1000
      { symbol: 'D', instrumentType: 'EQUITY', quantity: 10, avgEntryPrice: 100, currentPrice: 100, sector: 'FMCG' }, // 1000
    ],
    cashBalance: 1112, // ~ makes deployed% land near the 72.5% target midpoint
    asOf: new Date().toISOString(),
  };
}

describe('PortfolioAnalyzer.analyzeDiversification', () => {
  const analyzer = new PortfolioAnalyzer();

  it('computes HHI correctly for a concentrated 80/20 portfolio', () => {
    const result = analyzer.analyzeDiversification(buildConcentratedPortfolio());
    // HHI = 0.8^2 + 0.2^2 = 0.64 + 0.04 = 0.68
    expect(result.herfindahlIndex).toBeCloseTo(0.68, 5);
    expect(result.topPositionWeight).toBeCloseTo(0.8, 5);
  });

  it('flags a warning when top position exceeds the concentration threshold', () => {
    const result = analyzer.analyzeDiversification(buildConcentratedPortfolio());
    expect(result.warnings.some((w) => w.includes('RELIANCE'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('HHI'))).toBe(true);
  });

  it('computes low HHI and no concentration warnings for an evenly-weighted portfolio', () => {
    const result = analyzer.analyzeDiversification(buildDiversifiedPortfolio());
    // 4 equal positions of ~1000 each out of 4000 position value (cash excluded from position weighting
    // is NOT the case here — total includes cash, so weights are position/total, still equal across the 4)
    expect(result.herfindahlIndex).toBeLessThan(0.3);
    expect(result.warnings.some((w) => w.includes('HHI'))).toBe(false);
  });

  it('aggregates sector concentration when sector data is present', () => {
    const result = analyzer.analyzeDiversification(buildDiversifiedPortfolio());
    expect(Object.keys(result.sectorConcentration)).toEqual(
      expect.arrayContaining(['IT', 'BANKING', 'ENERGY', 'FMCG'])
    );
  });

  it('returns a no-positions warning for an empty portfolio', () => {
    const result = analyzer.analyzeDiversification({ positions: [], cashBalance: 1000, asOf: new Date().toISOString() });
    expect(result.herfindahlIndex).toBe(0);
    expect(result.warnings).toContain('Portfolio has no open positions');
  });
});

describe('PortfolioAnalyzer.analyzePositionRisks', () => {
  const analyzer = new PortfolioAnalyzer();

  it('flags the dominant position as high risk due to size', () => {
    const result = analyzer.analyzePositionRisks(buildConcentratedPortfolio());
    const reliance = result.find((r) => r.symbol === 'RELIANCE')!;
    expect(reliance.positionSizePercent).toBeCloseTo(80, 5);
    expect(reliance.riskLevel).toBe('high');
  });

  it('computes unrealized P&L percent correctly', () => {
    const result = analyzer.analyzePositionRisks(buildConcentratedPortfolio());
    const reliance = result.find((r) => r.symbol === 'RELIANCE')!;
    // (800-700)/700 * 100 = 14.28...
    expect(reliance.unrealizedPnLPercent).toBeCloseTo(14.2857, 3);
  });

  it('marks a moderately-sized, flat position as medium risk (20% > 15% threshold)', () => {
    const result = analyzer.analyzePositionRisks(buildConcentratedPortfolio());
    const tcs = result.find((r) => r.symbol === 'TCS')!;
    expect(tcs.positionSizePercent).toBeCloseTo(20, 5);
    expect(tcs.riskLevel).toBe('medium');
  });

  it('returns empty array for an empty portfolio', () => {
    const result = analyzer.analyzePositionRisks({ positions: [], cashBalance: 1000, asOf: new Date().toISOString() });
    expect(result).toHaveLength(0);
  });
});

describe('PortfolioAnalyzer.suggestCapitalAllocation', () => {
  const analyzer = new PortfolioAnalyzer();

  it('suggests reducing the oversized position', () => {
    const result = analyzer.suggestCapitalAllocation(buildConcentratedPortfolio());
    expect(result.some((s) => s.symbol === 'RELIANCE' && s.action === 'reduce')).toBe(true);
  });

  it('suggests exit for a position beyond the loss threshold', () => {
    const losingPortfolio: Portfolio = {
      positions: [
        { symbol: 'LOSER', instrumentType: 'EQUITY', quantity: 10, avgEntryPrice: 100, currentPrice: 80 }, // -20%
      ],
      cashBalance: 0,
      asOf: new Date().toISOString(),
    };
    const result = analyzer.suggestCapitalAllocation(losingPortfolio);
    expect(result.some((s) => s.symbol === 'LOSER' && s.action === 'exit')).toBe(true);
  });

  it('suggests holding new capital when portfolio is over-deployed', () => {
    const overDeployed: Portfolio = {
      positions: [{ symbol: 'X', instrumentType: 'EQUITY', quantity: 10, avgEntryPrice: 100, currentPrice: 100 }],
      cashBalance: 10, // 1000 position value vs 10 cash -> ~99% deployed
      asOf: new Date().toISOString(),
    };
    const result = analyzer.suggestCapitalAllocation(overDeployed);
    expect(result.some((s) => s.action === 'hold' && !s.symbol)).toBe(true);
  });

  it('suggests increasing deployment when heavily under-invested', () => {
    const underDeployed: Portfolio = {
      positions: [{ symbol: 'X', instrumentType: 'EQUITY', quantity: 1, avgEntryPrice: 100, currentPrice: 100 }],
      cashBalance: 10000, // position value 100 vs cash 10000 -> ~1% deployed
      asOf: new Date().toISOString(),
    };
    const result = analyzer.suggestCapitalAllocation(underDeployed);
    expect(result.some((s) => s.action === 'increase' && !s.symbol)).toBe(true);
  });
});

describe('PortfolioAnalyzer.analyzeProfitLoss', () => {
  const analyzer = new PortfolioAnalyzer();

  it('computes total unrealized P&L correctly', () => {
    const result = analyzer.analyzeProfitLoss(buildConcentratedPortfolio());
    // RELIANCE: (800-700)*10 = 1000; TCS: (400-400)*5 = 0 -> total 1000
    expect(result.totalUnrealizedPnL).toBeCloseTo(1000, 5);
  });

  it('identifies best and worst performing positions', () => {
    const result = analyzer.analyzeProfitLoss(buildConcentratedPortfolio());
    expect(result.bestPosition?.symbol).toBe('RELIANCE');
    expect(result.worstPosition?.symbol).toBe('TCS');
  });

  it('computes win rate only when closedTrades are supplied', () => {
    const withoutTrades = analyzer.analyzeProfitLoss(buildConcentratedPortfolio());
    expect(withoutTrades.winRate).toBeUndefined();

    const closedTrades: ClosedTrade[] = [
      { symbol: 'A', realizedPnLPercent: 10 },
      { symbol: 'B', realizedPnLPercent: -5 },
      { symbol: 'C', realizedPnLPercent: 3 },
    ];
    const withTrades = analyzer.analyzeProfitLoss(buildConcentratedPortfolio(), closedTrades);
    // 2 of 3 trades positive -> 66.67%
    expect(withTrades.winRate).toBeCloseTo(66.6667, 3);
  });
});

describe('PortfolioAnalyzer.analyzeHealth', () => {
  const analyzer = new PortfolioAnalyzer();

  it('produces a lower health score for a concentrated, high-risk portfolio than a diversified one', () => {
    const concentratedScore = analyzer.analyzeHealth(buildConcentratedPortfolio()).score;
    const diversifiedScore = analyzer.analyzeHealth(buildDiversifiedPortfolio()).score;
    expect(diversifiedScore).toBeGreaterThan(concentratedScore);
  });

  it('returns exactly 4 weighted factors summing to the reported score', () => {
    const result = analyzer.analyzeHealth(buildDiversifiedPortfolio());
    expect(result.factors).toHaveLength(4);
    const totalWeight = result.factors.reduce((sum, f) => sum + f.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 6);
    const summedContributions = result.factors.reduce((sum, f) => sum + f.contribution, 0);
    expect(result.score).toBeCloseTo(summedContributions, 1);
  });

  it('clamps score within 0..100 bounds', () => {
    const result = analyzer.analyzeHealth(buildConcentratedPortfolio());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('PortfolioAnalyzer.generateSummary', () => {
  const analyzer = new PortfolioAnalyzer();

  it('composes all sub-analyses into one summary with schemaVersion 1', () => {
    const summary = analyzer.generateSummary(buildConcentratedPortfolio());
    expect(summary.schemaVersion).toBe(1);
    expect(summary.healthScore.score).toBeGreaterThanOrEqual(0);
    expect(summary.positionRisks).toHaveLength(2);
    expect(summary.narrativeSummary.length).toBeGreaterThan(0);
  });

  it('includes high-risk symbols in the narrative when present', () => {
    const summary = analyzer.generateSummary(buildConcentratedPortfolio());
    expect(summary.narrativeSummary).toContain('RELIANCE');
  });

  it('passes through closedTrades to the P&L insight section', () => {
    const closedTrades: ClosedTrade[] = [{ symbol: 'A', realizedPnLPercent: 5 }];
    const summary = analyzer.generateSummary(buildConcentratedPortfolio(), closedTrades);
    expect(summary.pnlInsights.winRate).toBe(100);
  });
});