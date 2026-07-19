/**
 * packages/phase6-tradingview/src/contracts/INewsCache.ts
 * Artha AI — Phase 6 Risk Engine
 */

import { NewsImpactAssessment } from '../types';

export interface INewsCache {
  /**
   * Get news impact assessment for a symbol.
   * Returns null if no news cache is available.
   */
  getImpact(symbol_id: string): NewsImpactAssessment | null;

  /**
   * Refresh news cache — called by a background job.
   */
  refresh(): Promise<void>;
}
