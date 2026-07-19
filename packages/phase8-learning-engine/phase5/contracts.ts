/**
 * phase8/phase5/contracts.ts
 *
 * BOUNDARY FILE — NOT a real Phase 5 integration.
 * Phase 5 is frozen/real elsewhere in the repo, but its exact module path
 * was not available when this file was generated. This declares the shape
 * Phase 8 needs (per phase8-contracts-v1.md §1) so Phase 8 compiles today.
 *
 * ACTION REQUIRED: once you confirm Phase 5's real signal-engine path,
 * replace this file's content with a re-export from the real module:
 *   export type { ISignalQualityModel, IWinRateProvider } from '<real-phase5-path>';
 * No other Phase 8 file needs to change when you do this — they all import
 * from this local path.
 */

export interface SignalFeatures {
  readonly [key: string]: number;
}

export interface ISignalQualityModel {
  readonly isReady: boolean;
  predict(features: SignalFeatures): number;
}

export interface IWinRateProvider {
  readonly source: string;
  getWinRate(signalType: string, regime: string): number;
}
