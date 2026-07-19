/**
 * packages/phase6-tradingview/src/liquidity/LiquidityChecker.ts
 * Artha AI — Phase 6 Risk Engine — Stage 4
 *
 * Checks that a symbol meets minimum liquidity requirements:
 *   - Average Daily Volume (ADV) ≥ min_adv_shares
 *   - Average Daily Turnover (ADT) ≥ min_adt_crores
 *   - Bid-ask spread ≤ max_spread_pct
 *
 * Additionally caps order qty to max_adv_participation_pct of ADV
 * to avoid excessive market impact.
 *
 * All data comes from the pre-warmed IMarketDataCache — zero DB I/O.
 */

export interface LiquidityCheckInput {
  symbol_id: string;
  ticker: string;
  qty: number;
  entry_price: number;

  // From market data cache
  adv_shares: number | null;   // 20-day avg daily volume in shares
  adt_crores: number | null;   // 20-day avg daily turnover in crores
  spread_pct: number;          // (ask - bid) / mid × 100

  // Thresholds from config
  min_adv_shares: number;        // e.g. 50_000
  min_adt_crores: number;        // e.g. 5
  max_spread_pct: number;        // e.g. 0.20 (0.20%)
  max_adv_participation_pct: number; // e.g. 0.02 (2% of ADV)
}

export interface LiquidityCheckResult {
  passed: boolean;
  adjusted_qty: number;
  reject_reason?: string;
  binding_limit: 'adv' | 'adt' | 'spread' | 'participation' | 'none';
  detail: string;
}

export class LiquidityChecker {
  check(input: LiquidityCheckInput): LiquidityCheckResult {
    const {
      qty, adv_shares, adt_crores, spread_pct, entry_price,
      min_adv_shares, min_adt_crores, max_spread_pct, max_adv_participation_pct,
    } = input;

    // Spread hard block
    if (spread_pct > max_spread_pct) {
      return {
        passed: false,
        adjusted_qty: 0,
        reject_reason: `Bid-ask spread too wide: ${spread_pct.toFixed(3)}% > ${max_spread_pct.toFixed(3)}%`,
        binding_limit: 'spread',
        detail: `spread=${spread_pct.toFixed(3)}%`,
      };
    }

    // ADV check
    if (adv_shares !== null && adv_shares < min_adv_shares) {
      return {
        passed: false,
        adjusted_qty: 0,
        reject_reason: `ADV too low: ${adv_shares.toLocaleString()} < ${min_adv_shares.toLocaleString()} shares/day`,
        binding_limit: 'adv',
        detail: `adv=${adv_shares.toLocaleString()}`,
      };
    }

    // ADT check
    if (adt_crores !== null && adt_crores < min_adt_crores) {
      return {
        passed: false,
        adjusted_qty: 0,
        reject_reason: `ADT too low: ₹${adt_crores.toFixed(2)}Cr < ₹${min_adt_crores}Cr/day`,
        binding_limit: 'adt',
        detail: `adt=${adt_crores.toFixed(2)}Cr`,
      };
    }

    // ADV participation cap
    let adjusted_qty = qty;
    let binding_limit: LiquidityCheckResult['binding_limit'] = 'none';

    if (adv_shares !== null) {
      const max_qty_from_participation = Math.floor(adv_shares * max_adv_participation_pct);
      if (qty > max_qty_from_participation) {
        adjusted_qty = max_qty_from_participation;
        binding_limit = 'participation';
      }
    }

    const final_qty = Math.max(0, adjusted_qty);

    return {
      passed: final_qty > 0,
      adjusted_qty: final_qty,
      binding_limit,
      detail: `adv=${adv_shares ?? 'unknown'} adt=${adt_crores ?? 'unknown'}Cr spread=${spread_pct.toFixed(3)}% participation_cap_qty=${adv_shares ? Math.floor(adv_shares * max_adv_participation_pct) : 'N/A'} → qty=${final_qty}`,
    };
  }
}
