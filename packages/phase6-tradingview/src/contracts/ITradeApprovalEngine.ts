/**
 * packages/phase6-tradingview/src/contracts/ITradeApprovalEngine.ts
 * Artha AI — Phase 6 Risk Engine
 */

import { SignalEvent, PortfolioSnapshot, TradeApprovalResult } from '../types';

export interface ITradeApprovalEngine {
  /**
   * Outermost evaluation interface.
   * Runs the macro/regime checks, the validation pipeline, and calculates confidence.
   */
  evaluate(signal: SignalEvent, portfolio: PortfolioSnapshot): TradeApprovalResult;

  /**
   * Clears engine cache and state for walk-forward folding.
   */
  resetForFold(): void;
}
