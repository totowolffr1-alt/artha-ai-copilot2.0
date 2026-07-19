/**
 * packages/phase6-tradingview/src/index.ts
 * Artha AI — Phase 6 Risk Engine
 *
 * Public exports for the @artha/phase6-risk-engine package.
 */

// Core Types
export * from './types';
export * from './errors';

// Contracts
export type { IRiskEngine }              from './contracts/IRiskEngine';
export type { IRiskValidationPipeline }  from './contracts/IRiskValidationPipeline';
export type { IRiskStage }               from './contracts/IRiskStage';
export type { IRiskMonitor, RiskSnapshot } from './contracts/IRiskMonitor';
export type { ITradeApprovalEngine }     from './contracts/ITradeApprovalEngine';
export type { IMarketDataCache, L1Snapshot } from './contracts/IMarketDataCache';
export type { INewsCache }               from './contracts/INewsCache';

// Stage 0 — Market Risk Engine
export { MarketRiskEngine }              from './market/MarketRiskEngine';
export { NiftyTrendAnalyser }            from './market/indices/NiftyTrendAnalyser';
export { BankNiftyTrendAnalyser }        from './market/indices/BankNiftyTrendAnalyser';
export { VIXAnalyser }                   from './market/vix/VIXAnalyser';
export { MarketRegimeAggregator }        from './market/regime/MarketRegimeAggregator';

// Stage 1 — Sizing & Exposure
export { ConvictionScorer }              from './sizer/ConvictionScorer';
export { PositionSizer }                 from './sizer/PositionSizer';
export { ConvictionSizer }               from './sizer/ConvictionSizer';
export { SectorMapper }                  from './exposure/SectorMapper';
export { ExposureManager }               from './exposure/ExposureManager';
export { CapitalChecker }                from './capital/CapitalChecker';
export { CorrelationMatrix }             from './portfolio/correlation/CorrelationMatrix';
export { PortfolioHeatCalculator }       from './portfolio/heat/PortfolioHeatCalculator';
export { OverlapDetector }               from './portfolio/overlap/OverlapDetector';
export { PortfolioRiskEngine }           from './portfolio/PortfolioRiskEngine';

// Stage 2 — Volatility & Risk
export { VolatilityAnalyser }            from './volatility/VolatilityAnalyser';
export { PortfolioVaR }                  from './var/PortfolioVaR';
export { DrawdownTracker }               from './drawdown/DrawdownTracker';

// Stage 3 — Regime
export { RegimeFilter }                  from './regime/RegimeFilter';
export { NiftyTrendGuard }               from './regime/NiftyTrendGuard';

// Stage 4 — Liquidity
export { LiquidityChecker }              from './liquidity/LiquidityChecker';

// Stage 5 — Swing Risk
export { EventRiskChecker }              from './events/EventRiskChecker';
export { MarketStatusChecker }           from './market_status/MarketStatusChecker';
export { OvernightGapRiskChecker }       from './gap/OvernightGapRiskChecker';
export { NewsImpactRiskChecker, NullNewsCache } from './events/NewsImpactRiskChecker';

// System
export { CircuitBreaker }                from './breaker/CircuitBreaker';
export { RiskMonitor }                   from './monitor/RiskMonitor';

// Pipeline & Approval
export { RiskValidationPipeline }        from './pipeline/RiskValidationPipeline';
export { TradeApprovalEngine }           from './approval/TradeApprovalEngine';
export { createPipelineContext }         from './pipeline/PipelineContext';

// Risk Profiles
export { SmallCapRiskProfile }           from './risk/SmallCapRiskProfile';
export type { SmallCapTier }             from './risk/SmallCapRiskProfile';

