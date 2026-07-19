/**
 * ISignalRepository.ts — Artha AI Phase 3
 * Signal lifecycle contract.
 */
import type { SignalRow, SignalStatus } from '../../types/domain';
import type { InsertSignal } from '../../types/insert-dtos';

export interface ISignalRepository {
  insert(signal: InsertSignal): Promise<SignalRow>;

  findById(signalId: string): Promise<SignalRow | null>;

  /** All pending signals — used by signal engine dashboard. */
  findPending(symbolId?: string): Promise<SignalRow[]>;

  /** Mark signal as acted and link to the resulting trade. */
  markActed(signalId: string, tradeId: string): Promise<void>;

  /** Update signal status. */
  updateStatus(signalId: string, status: SignalStatus): Promise<void>;

  /** Recent signals by strategy run — for strategy audit. */
  findByStrategyRun(strategyRunId: string, limit?: number): Promise<SignalRow[]>;
}
