/**
 * Phase 10D — Portfolio Contract
 * ================================
 * Defines the shape of portfolio data consumed by PortfolioAnalyzer.
 *
 * EXTERNAL DEPENDENCY DISCLOSURE
 * -------------------------------
 * No live portfolio data source exists in this repo yet — Phase 3
 * (Database Layer) and Phase 7 (Broker Integration) are design-docs only,
 * per the Phase 10 system integration audit. `Portfolio`/`Position` below
 * define the SHAPE a real data source (DB query or broker holdings API)
 * would eventually supply. This is not a live integration — callers must
 * construct this data themselves today (e.g. from manual input, a mock,
 * or a future adapter), and PortfolioAnalyzer treats it as pre-validated
 * input with no assumption about where it came from.
 *
 * ASSUMPTION: long-only positions. Short positions are out of scope for
 * this sub-phase — `quantity` and P&L formulas below assume quantity > 0
 * and profit increasing with price. Flagged here rather than silently
 * mishandling a short position if one is ever passed in.
 */

export type InstrumentType = 'EQUITY' | 'FNO' | 'COMMODITY';

export interface Position {
  readonly symbol: string;
  readonly instrumentType: InstrumentType;
  readonly quantity: number; // assumed > 0 (long-only, see module doc)
  readonly avgEntryPrice: number;
  readonly currentPrice: number;
  readonly sector?: string; // optional — sector concentration analysis is skipped without it
  readonly realizedPnL?: number; // optional — realized P&L from partial exits on this position, if any
}

export interface Portfolio {
  readonly positions: ReadonlyArray<Position>;
  readonly cashBalance: number;
  readonly asOf: string; // ISO 8601
}

/** Optional record of a fully-closed trade, used only for win-rate calculation in P&L insights. */
export interface ClosedTrade {
  readonly symbol: string;
  readonly realizedPnLPercent: number;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface DiversificationAnalysis {
  readonly herfindahlIndex: number; // 0 (perfectly diversified) .. 1 (single position)
  readonly topPositionWeight: number; // 0..1, largest single position's share of portfolio value
  readonly sectorConcentration: Readonly<Record<string, number>>; // sector -> weight 0..1; empty if no sector data
  readonly warnings: ReadonlyArray<string>;
}

export interface PositionRiskAnalysis {
  readonly symbol: string;
  readonly positionSizePercent: number; // 0..100, share of total portfolio value
  readonly unrealizedPnLPercent: number; // can be negative
  readonly riskLevel: RiskLevel;
  readonly warnings: ReadonlyArray<string>;
}

export type AllocationAction = 'reduce' | 'exit' | 'hold' | 'increase';

export interface CapitalAllocationSuggestion {
  readonly symbol?: string; // absent for portfolio-level suggestions (e.g. "deploy idle cash")
  readonly action: AllocationAction;
  readonly rationale: string;
}

export interface ProfitLossInsight {
  readonly totalRealizedPnL: number;
  readonly totalUnrealizedPnL: number;
  readonly winRate?: number; // 0..100, only present if closedTrades were supplied
  readonly bestPosition?: { symbol: string; unrealizedPnLPercent: number };
  readonly worstPosition?: { symbol: string; unrealizedPnLPercent: number };
  readonly insights: ReadonlyArray<string>;
}

export interface HealthScoreFactor {
  readonly factorId: string;
  readonly rawScore: number; // 0..100
  readonly weight: number;
  readonly contribution: number;
  readonly rationale: string;
}

export interface PortfolioHealthScore {
  readonly score: number; // 0..100 composite
  readonly factors: ReadonlyArray<HealthScoreFactor>;
}

export interface PortfolioSummary {
  readonly healthScore: PortfolioHealthScore;
  readonly diversification: DiversificationAnalysis;
  readonly positionRisks: ReadonlyArray<PositionRiskAnalysis>;
  readonly allocationSuggestions: ReadonlyArray<CapitalAllocationSuggestion>;
  readonly pnlInsights: ProfitLossInsight;
  readonly narrativeSummary: string;
  readonly generatedAt: string; // ISO 8601
  readonly schemaVersion: 1;
}

export interface IPortfolioAnalyzer {
  analyzeHealth(portfolio: Portfolio): PortfolioHealthScore;
  analyzeDiversification(portfolio: Portfolio): DiversificationAnalysis;
  analyzePositionRisks(portfolio: Portfolio): ReadonlyArray<PositionRiskAnalysis>;
  suggestCapitalAllocation(portfolio: Portfolio): ReadonlyArray<CapitalAllocationSuggestion>;
  analyzeProfitLoss(portfolio: Portfolio, closedTrades?: ReadonlyArray<ClosedTrade>): ProfitLossInsight;
  generateSummary(portfolio: Portfolio, closedTrades?: ReadonlyArray<ClosedTrade>): PortfolioSummary;
}