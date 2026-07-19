import {
  Portfolio,
  Position,
  ClosedTrade,
  DiversificationAnalysis,
  PositionRiskAnalysis,
  CapitalAllocationSuggestion,
  ProfitLossInsight,
  PortfolioHealthScore,
  HealthScoreFactor,
  PortfolioSummary,
  IPortfolioAnalyzer,
  RiskLevel,
} from '../contracts';

/**
 * Phase 10D — PortfolioAnalyzer
 * ===============================
 * Imports only from ../contracts. No coupling to ConvictionEngine or
 * ExplanationGenerator — portfolio analysis is independent of per-trade
 * confidence scoring.
 *
 * THRESHOLDS
 * ----------
 * All thresholds below (concentration limits, risk bands, target cash
 * deployment) are stated explicitly as named constants rather than buried
 * magic numbers, so they can be tuned later without hunting through the
 * math. They are reasonable starting defaults, not derived from your
 * specific risk tolerance — treat them as a first cut to refine.
 */

const TOP_POSITION_WARNING_THRESHOLD = 0.25; // single position > 25% of portfolio
const HHI_WARNING_THRESHOLD = 0.3; // HHI > 0.3 is considered highly concentrated

const POSITION_SIZE_HIGH_RISK_PERCENT = 25;
const POSITION_SIZE_MEDIUM_RISK_PERCENT = 15;
const UNREALIZED_LOSS_HIGH_RISK_PERCENT = -15;
const UNREALIZED_LOSS_MEDIUM_RISK_PERCENT = -8;

const REDUCE_SUGGESTION_SIZE_PERCENT = 25;
const EXIT_SUGGESTION_LOSS_PERCENT = -15;
const CASH_OVER_DEPLOYED_PERCENT = 95; // less than 5% cash buffer remaining
const CASH_UNDER_DEPLOYED_PERCENT = 50; // more than half the portfolio sitting in cash

const HEALTH_SCORE_WEIGHTS = {
  diversification: 0.3,
  riskExposure: 0.25,
  capitalUtilization: 0.2,
  pnlHealth: 0.25,
} as const;

function positionValue(p: Position): number {
  return p.quantity * p.currentPrice;
}

function totalPortfolioValue(portfolio: Portfolio): number {
  const positionsValue = portfolio.positions.reduce((sum, p) => sum + positionValue(p), 0);
  return positionsValue + portfolio.cashBalance;
}

function unrealizedPnLPercent(p: Position): number {
  if (p.avgEntryPrice === 0) return 0;
  return ((p.currentPrice - p.avgEntryPrice) / p.avgEntryPrice) * 100;
}

export class PortfolioAnalyzer implements IPortfolioAnalyzer {
  analyzeDiversification(portfolio: Portfolio): DiversificationAnalysis {
    const totalValue = totalPortfolioValue(portfolio);
    if (totalValue <= 0 || portfolio.positions.length === 0) {
      return {
        herfindahlIndex: 0,
        topPositionWeight: 0,
        sectorConcentration: {},
        warnings: portfolio.positions.length === 0 ? ['Portfolio has no open positions'] : [],
      };
    }

    const weights = portfolio.positions.map((p) => positionValue(p) / totalValue);
    const herfindahlIndex = weights.reduce((sum, w) => sum + w * w, 0);
    const topPositionWeight = Math.max(...weights);

    const sectorConcentration: Record<string, number> = {};
    portfolio.positions.forEach((p, i) => {
      if (p.sector) {
        sectorConcentration[p.sector] = (sectorConcentration[p.sector] ?? 0) + weights[i];
      }
    });

    const warnings: string[] = [];
    if (topPositionWeight > TOP_POSITION_WARNING_THRESHOLD) {
      const topSymbol = portfolio.positions[weights.indexOf(topPositionWeight)].symbol;
      warnings.push(
        `${topSymbol} is ${(topPositionWeight * 100).toFixed(1)}% of the portfolio, above the ${TOP_POSITION_WARNING_THRESHOLD * 100}% single-position guideline`
      );
    }
    if (herfindahlIndex > HHI_WARNING_THRESHOLD) {
      warnings.push(
        `Portfolio concentration (HHI ${herfindahlIndex.toFixed(2)}) exceeds the ${HHI_WARNING_THRESHOLD} guideline — holdings are concentrated in few positions`
      );
    }
    if (Object.keys(sectorConcentration).length === 0 && portfolio.positions.length > 0) {
      warnings.push('Sector data not provided for any position — sector concentration could not be assessed');
    }

    return { herfindahlIndex, topPositionWeight, sectorConcentration, warnings };
  }

  analyzePositionRisks(portfolio: Portfolio): ReadonlyArray<PositionRiskAnalysis> {
    const totalValue = totalPortfolioValue(portfolio);
    if (totalValue <= 0) return [];

    return portfolio.positions.map((p) => {
      const positionSizePercent = (positionValue(p) / totalValue) * 100;
      const pnlPercent = unrealizedPnLPercent(p);
      const warnings: string[] = [];

      let riskLevel: RiskLevel = 'low';
      if (positionSizePercent > POSITION_SIZE_HIGH_RISK_PERCENT || pnlPercent < UNREALIZED_LOSS_HIGH_RISK_PERCENT) {
        riskLevel = 'high';
      } else if (
        positionSizePercent > POSITION_SIZE_MEDIUM_RISK_PERCENT ||
        pnlPercent < UNREALIZED_LOSS_MEDIUM_RISK_PERCENT
      ) {
        riskLevel = 'medium';
      }

      if (positionSizePercent > POSITION_SIZE_HIGH_RISK_PERCENT) {
        warnings.push(`Position size ${positionSizePercent.toFixed(1)}% exceeds ${POSITION_SIZE_HIGH_RISK_PERCENT}% of portfolio`);
      }
      if (pnlPercent < UNREALIZED_LOSS_HIGH_RISK_PERCENT) {
        warnings.push(`Unrealized loss of ${pnlPercent.toFixed(1)}% exceeds the ${UNREALIZED_LOSS_HIGH_RISK_PERCENT}% high-risk threshold`);
      }

      return { symbol: p.symbol, positionSizePercent, unrealizedPnLPercent: pnlPercent, riskLevel, warnings };
    });
  }

  suggestCapitalAllocation(portfolio: Portfolio): ReadonlyArray<CapitalAllocationSuggestion> {
    const totalValue = totalPortfolioValue(portfolio);
    const suggestions: CapitalAllocationSuggestion[] = [];
    if (totalValue <= 0) return suggestions;

    const positionRisks = this.analyzePositionRisks(portfolio);
    positionRisks.forEach((risk) => {
      if (risk.unrealizedPnLPercent < EXIT_SUGGESTION_LOSS_PERCENT) {
        suggestions.push({
          symbol: risk.symbol,
          action: 'exit',
          rationale: `Unrealized loss of ${risk.unrealizedPnLPercent.toFixed(1)}% exceeds the ${EXIT_SUGGESTION_LOSS_PERCENT}% review threshold — consider reassessing the thesis for this position`,
        });
      } else if (risk.positionSizePercent > REDUCE_SUGGESTION_SIZE_PERCENT) {
        suggestions.push({
          symbol: risk.symbol,
          action: 'reduce',
          rationale: `Position is ${risk.positionSizePercent.toFixed(1)}% of portfolio, above the ${REDUCE_SUGGESTION_SIZE_PERCENT}% concentration guideline — consider trimming to reduce single-name risk`,
        });
      }
    });

    const deployedPercent = ((totalValue - portfolio.cashBalance) / totalValue) * 100;
    if (deployedPercent > CASH_OVER_DEPLOYED_PERCENT) {
      suggestions.push({
        action: 'hold',
        rationale: `Portfolio is ${deployedPercent.toFixed(1)}% deployed, leaving less than ${100 - CASH_OVER_DEPLOYED_PERCENT}% cash buffer — consider holding new capital rather than adding exposure`,
      });
    } else if (deployedPercent < CASH_UNDER_DEPLOYED_PERCENT) {
      suggestions.push({
        action: 'increase',
        rationale: `Only ${deployedPercent.toFixed(1)}% of portfolio is deployed — significant idle cash could be put to work if suitable opportunities exist`,
      });
    }

    return suggestions;
  }

  analyzeProfitLoss(portfolio: Portfolio, closedTrades?: ReadonlyArray<ClosedTrade>): ProfitLossInsight {
    const totalRealizedPnL = portfolio.positions.reduce((sum, p) => sum + (p.realizedPnL ?? 0), 0);
    const totalUnrealizedPnL = portfolio.positions.reduce(
      (sum, p) => sum + (p.currentPrice - p.avgEntryPrice) * p.quantity,
      0
    );

    const withPnLPercent = portfolio.positions.map((p) => ({
      symbol: p.symbol,
      unrealizedPnLPercent: unrealizedPnLPercent(p),
    }));

    const bestPosition =
      withPnLPercent.length > 0
        ? withPnLPercent.reduce((best, cur) => (cur.unrealizedPnLPercent > best.unrealizedPnLPercent ? cur : best))
        : undefined;
    const worstPosition =
      withPnLPercent.length > 0
        ? withPnLPercent.reduce((worst, cur) => (cur.unrealizedPnLPercent < worst.unrealizedPnLPercent ? cur : worst))
        : undefined;

    const winRate =
      closedTrades && closedTrades.length > 0
        ? (closedTrades.filter((t) => t.realizedPnLPercent > 0).length / closedTrades.length) * 100
        : undefined;

    const insights: string[] = [];
    if (totalUnrealizedPnL >= 0) {
      insights.push(`Portfolio shows a net unrealized gain of ${totalUnrealizedPnL.toFixed(2)}`);
    } else {
      insights.push(`Portfolio shows a net unrealized loss of ${Math.abs(totalUnrealizedPnL).toFixed(2)}`);
    }
    if (bestPosition) {
      insights.push(`Best performer: ${bestPosition.symbol} at ${bestPosition.unrealizedPnLPercent.toFixed(1)}%`);
    }
    if (worstPosition) {
      insights.push(`Worst performer: ${worstPosition.symbol} at ${worstPosition.unrealizedPnLPercent.toFixed(1)}%`);
    }
    if (winRate !== undefined) {
      insights.push(`Win rate over ${closedTrades!.length} closed trades: ${winRate.toFixed(1)}%`);
    }

    return { totalRealizedPnL, totalUnrealizedPnL, winRate, bestPosition, worstPosition, insights };
  }

  analyzeHealth(portfolio: Portfolio): PortfolioHealthScore {
    const totalValue = totalPortfolioValue(portfolio);
    const diversification = this.analyzeDiversification(portfolio);
    const positionRisks = this.analyzePositionRisks(portfolio);
    const pnl = this.analyzeProfitLoss(portfolio);

    const diversificationScore = Math.max(0, Math.min(100, (1 - diversification.herfindahlIndex) * 100));

    const highRiskCount = positionRisks.filter((r) => r.riskLevel === 'high').length;
    const riskExposureScore =
      positionRisks.length > 0 ? Math.max(0, 100 - (highRiskCount / positionRisks.length) * 100) : 100;

    const deployedPercent = totalValue > 0 ? ((totalValue - portfolio.cashBalance) / totalValue) * 100 : 0;
    const targetDeployment = (CASH_OVER_DEPLOYED_PERCENT + CASH_UNDER_DEPLOYED_PERCENT) / 2; // midpoint, ~72.5%
    const capitalUtilizationScore = Math.max(0, 100 - Math.abs(deployedPercent - targetDeployment) * 1.5);

    const unrealizedPnLPercentOfCapital = totalValue > 0 ? (pnl.totalUnrealizedPnL / totalValue) * 100 : 0;
    const pnlHealthScore = Math.max(0, Math.min(100, 100 + unrealizedPnLPercentOfCapital * 3));

    const factors: HealthScoreFactor[] = [
      {
        factorId: 'diversification',
        rawScore: Math.round(diversificationScore * 100) / 100,
        weight: HEALTH_SCORE_WEIGHTS.diversification,
        contribution: Math.round(diversificationScore * HEALTH_SCORE_WEIGHTS.diversification * 100) / 100,
        rationale: `Diversification score derived from Herfindahl index ${diversification.herfindahlIndex.toFixed(2)}`,
      },
      {
        factorId: 'risk_exposure',
        rawScore: Math.round(riskExposureScore * 100) / 100,
        weight: HEALTH_SCORE_WEIGHTS.riskExposure,
        contribution: Math.round(riskExposureScore * HEALTH_SCORE_WEIGHTS.riskExposure * 100) / 100,
        rationale: `${highRiskCount} of ${positionRisks.length} positions flagged high-risk`,
      },
      {
        factorId: 'capital_utilization',
        rawScore: Math.round(capitalUtilizationScore * 100) / 100,
        weight: HEALTH_SCORE_WEIGHTS.capitalUtilization,
        contribution: Math.round(capitalUtilizationScore * HEALTH_SCORE_WEIGHTS.capitalUtilization * 100) / 100,
        rationale: `${deployedPercent.toFixed(1)}% of portfolio deployed, against a ~${targetDeployment.toFixed(0)}% target`,
      },
      {
        factorId: 'pnl_health',
        rawScore: Math.round(pnlHealthScore * 100) / 100,
        weight: HEALTH_SCORE_WEIGHTS.pnlHealth,
        contribution: Math.round(pnlHealthScore * HEALTH_SCORE_WEIGHTS.pnlHealth * 100) / 100,
        rationale: `Unrealized P&L is ${unrealizedPnLPercentOfCapital.toFixed(1)}% of total portfolio value`,
      },
    ];

    const score = Math.round(factors.reduce((sum, f) => sum + f.contribution, 0) * 100) / 100;
    return { score: Math.max(0, Math.min(100, score)), factors };
  }

  generateSummary(portfolio: Portfolio, closedTrades?: ReadonlyArray<ClosedTrade>): PortfolioSummary {
    const healthScore = this.analyzeHealth(portfolio);
    const diversification = this.analyzeDiversification(portfolio);
    const positionRisks = this.analyzePositionRisks(portfolio);
    const allocationSuggestions = this.suggestCapitalAllocation(portfolio);
    const pnlInsights = this.analyzeProfitLoss(portfolio, closedTrades);

    const highRiskSymbols = positionRisks.filter((r) => r.riskLevel === 'high').map((r) => r.symbol);
    const narrativeParts: string[] = [
      `Portfolio health score: ${healthScore.score}/100.`,
      diversification.warnings.length > 0
        ? `Diversification concerns: ${diversification.warnings.join('; ')}.`
        : 'No diversification concerns flagged.',
      highRiskSymbols.length > 0
        ? `High-risk positions: ${highRiskSymbols.join(', ')}.`
        : 'No positions currently flagged high-risk.',
      pnlInsights.insights[0] ?? '',
    ];

    return {
      healthScore,
      diversification,
      positionRisks,
      allocationSuggestions,
      pnlInsights,
      narrativeSummary: narrativeParts.filter(Boolean).join(' '),
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
    };
  }
}