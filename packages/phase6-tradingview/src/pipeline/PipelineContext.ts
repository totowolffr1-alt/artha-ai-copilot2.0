/**
 * packages/phase6-tradingview/src/pipeline/PipelineContext.ts
 * Artha AI — Phase 6 Risk Engine
 *
 * Mutable context threaded through all 5 pipeline stages.
 * Each stage reads the current qty and may reduce it.
 * Reasons accumulate for the final TradeApprovalResult.
 */

export interface PipelineContext {
  qty: number;
  conviction: number;
  sizing_method: string;
  reasons: string[];
  stage_reached: number;
}

export function createPipelineContext(qty: number, conviction: number, sizing_method: string): PipelineContext {
  return { qty, conviction, sizing_method, reasons: [], stage_reached: 0 };
}
