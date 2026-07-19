/**
 * packages/phase6-tradingview/src/contracts/IRiskStage.ts
 * Artha AI — Phase 6 Risk Engine
 */

import {
  SignalEvent,
  PortfolioSnapshot,
  RiskConfig,
  MarketRiskContext,
  StageValidationResult,
} from '../types';

export interface IRiskStage {
  /**
   * Run validation checks for this specific pipeline stage.
   * Can suggest a reduced size (qty) if a limit is partially breached.
   */
  validate(
    signal: SignalEvent,
    portfolio: PortfolioSnapshot,
    qty: number,
    config: RiskConfig,
    context?: MarketRiskContext,
  ): StageValidationResult;

  /**
   * Reset any cached metrics/states for backtest fold transitions.
   */
  resetForFold?(): void;
}
