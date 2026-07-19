/**
 * packages/phase6-tradingview/src/contracts/IRiskEngine.ts
 * Artha AI — Phase 6 Risk Engine
 */

import { ITradeApprovalEngine } from './ITradeApprovalEngine';
import { IRiskMonitor } from './IRiskMonitor';

export interface IRiskEngine {
  // Trade execution entry point
  readonly approval: ITradeApprovalEngine;

  // UI / monitoring read surface
  readonly monitor: IRiskMonitor;

  // Pre-warms caches and loads startup state
  initialize(): Promise<void>;

  // Graceful shutdown, flushing metrics and logs
  shutdown(): Promise<void>;
}
