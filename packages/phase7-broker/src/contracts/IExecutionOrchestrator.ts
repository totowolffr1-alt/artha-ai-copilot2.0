/**
 * packages/phase7-broker/src/contracts/IExecutionOrchestrator.ts
 * Artha AI — Phase 7 Execution Orchestrator
 */

import { SignalEvent } from '../../../phase6-tradingview/src/types';
import { TradeApprovalResult } from '../../../phase6-tradingview/src/types';
import { ExecutionEvent, ExecutionResult } from '../types/domain';

export interface IExecutionOrchestrator {
  /**
   * Main entry point when a TradeApprovalResult is generated.
   * If APPROVED/REDUCED_SIZE, initiates entry order submission.
   * If REJECTED, invokes the ISignalRejectionWriter.
   * Returns the generated intent_id (or null if rejected).
   */
  handleVerdict(
    signal: SignalEvent,
    verdict: TradeApprovalResult,
    accountId?: string
  ): Promise<string | null>;

  /**
   * Ingest live quote updates (LTP) to evaluate and adjust smart trailing stop-losses.
   */
  onLiveQuote(symbol_id: string, ltp: number): Promise<void>;

  /**
   * Read surface for downstream (Phase 9) analysis.
   */
  getEvents(orderId: string): readonly ExecutionEvent[];
  getResult(orderId: string): ExecutionResult | null;
}
export interface ISignalRejectionWriter {
  markRejected(signalId: string, result: { reasons: string[] }): void;
}
