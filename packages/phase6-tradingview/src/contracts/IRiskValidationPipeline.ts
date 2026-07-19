/**
 * packages/phase6-tradingview/src/contracts/IRiskValidationPipeline.ts
 * Artha AI — Phase 6 Risk Engine
 */

import { SignalEvent, PortfolioSnapshot, RiskValidationResult } from '../types';

export interface IRiskValidationPipeline {
  /**
   * Validate a trade signal against the portfolio snapshot.
   * Runs all 5 risk verification stages sequentially.
   */
  validate(signal: SignalEvent, portfolio: PortfolioSnapshot): RiskValidationResult;

  /**
   * Clears state for backtesting walk-forward folds.
   */
  resetForFold(): void;
}
