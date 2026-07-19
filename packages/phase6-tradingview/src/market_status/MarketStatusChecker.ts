/**
 * packages/phase6-tradingview/src/market_status/MarketStatusChecker.ts
 * Artha AI — Phase 6 Risk Engine — Stage 5
 *
 * Checks NSE/SEBI regulatory status for a symbol.
 * Hard blocks on:
 *   - F&O ban list membership
 *   - Active SEBI trading restrictions
 *   - GSM Stage ≥ 5
 *
 * Data comes from the in-memory market_status and sebi_actions caches
 * hydrated from Phase 3 DB at startup and refreshed daily.
 *
 * Zero hot-path I/O — all lookups are O(1) hash-map reads.
 */

import { MarketStatusCheckResult, MarketStatusReason, SurveillanceStage, SwingRiskConfig } from '../types';

export interface SymbolStatusRecord {
  fno_banned: boolean;
  sebi_action_type?: 'TRADING_HALT' | 'TRADING_RESTRICTION' | 'INVESTIGATION_OPEN' | 'FREEZE_ORDER' | 'INSIDER_TRADING_PROBE';
  surveillance_stage: SurveillanceStage;
  t2t: boolean;
}

export class MarketStatusChecker {
  private readonly statusCache: Map<string, SymbolStatusRecord> = new Map();

  hydrate(symbol_id: string, record: SymbolStatusRecord): void {
    this.statusCache.set(symbol_id, record);
  }

  hydrateAll(entries: Array<{ symbol_id: string; record: SymbolStatusRecord }>): void {
    for (const { symbol_id, record } of entries) {
      this.statusCache.set(symbol_id, record);
    }
  }

  check(symbol_id: string, cfg: SwingRiskConfig): MarketStatusCheckResult {
    const record = this.statusCache.get(symbol_id);

    // Default: symbol not in any special status
    if (!record) {
      return {
        passed: true,
        detail: 'No regulatory status record — assumed clean',
        fno_banned: false,
        sebi_action_active: false,
        surveillance_stage: 'NONE',
      };
    }

    // F&O ban check
    if (cfg.block_on_fno_ban && record.fno_banned) {
      return {
        passed: false,
        reason: 'fno_ban_active',
        detail: 'Symbol is on NSE F&O ban list',
        fno_banned: true,
        sebi_action_active: false,
        surveillance_stage: record.surveillance_stage,
      };
    }

    // SEBI hard blocks
    const HARD_BLOCK_ACTIONS = new Set(['TRADING_HALT', 'TRADING_RESTRICTION', 'FREEZE_ORDER']);
    if (record.sebi_action_type && HARD_BLOCK_ACTIONS.has(record.sebi_action_type)) {
      return {
        passed: false,
        reason: 'sebi_trading_restriction',
        detail: `SEBI action active: ${record.sebi_action_type}`,
        fno_banned: record.fno_banned,
        sebi_action_active: true,
        surveillance_stage: record.surveillance_stage,
      };
    }

    // SEBI investigation open — reduces but doesn't block by default
    if (record.sebi_action_type === 'INVESTIGATION_OPEN' && cfg.block_on_sebi_investigation) {
      return {
        passed: false,
        reason: 'sebi_investigation_open',
        detail: 'SEBI investigation open — trading blocked per config',
        fno_banned: record.fno_banned,
        sebi_action_active: true,
        surveillance_stage: record.surveillance_stage,
      };
    }

    // GSM stage check — block Stage ≥ gsm_block_stage (default 5)
    const gsm_stage_num = this.parseGSMStage(record.surveillance_stage);
    if (gsm_stage_num !== null && gsm_stage_num >= cfg.gsm_block_stage) {
      return {
        passed: false,
        reason: 'gsm_stage_high',
        detail: `Graded Surveillance Measure Stage ${gsm_stage_num} — trading blocked`,
        fno_banned: record.fno_banned,
        sebi_action_active: false,
        surveillance_stage: record.surveillance_stage,
      };
    }

    return {
      passed: true,
      detail: `Status OK: fno=${record.fno_banned} surveillance=${record.surveillance_stage}`,
      fno_banned: record.fno_banned,
      sebi_action_active: !!record.sebi_action_type,
      surveillance_stage: record.surveillance_stage,
    };
  }

  private parseGSMStage(stage: SurveillanceStage): number | null {
    const match = stage.match(/^GSM_(\d)$/);
    return match ? parseInt(match[1], 10) : null;
  }
}
