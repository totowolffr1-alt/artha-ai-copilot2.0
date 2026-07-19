/**
 * packages/phase6-tradingview/src/contracts/IMarketDataCache.ts
 * Artha AI — Phase 6 Risk Engine
 */

export interface L1Snapshot {
  bid: number;
  ask: number;
  ltp: number;
  volume: number;
}

export interface IMarketDataCache {
  /**
   * Get pre-warmed Level-1 bid/ask snapshot for a symbol.
   */
  getL1Snapshot(symbol_id: string): L1Snapshot | null;

  /**
   * Average Daily Volume (20-day) for ADV checks.
   */
  getADV(symbol_id: string): number | null;

  /**
   * Average Daily Turnover (in Crores) for liquidity ADT checks.
   */
  getADT(symbol_id: string): number | null;

  /**
   * Get pre-warmed Nifty50 Level-1 snapshot.
   */
  getNiftyL1(): L1Snapshot | null;

  /**
   * Get current India VIX index level.
   */
  getVIX(): number | null;
}
