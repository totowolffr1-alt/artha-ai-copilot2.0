/**
 * packages/phase6-tradingview/src/var/PortfolioVaR.ts
 * Artha AI — Phase 6 Risk Engine — Stage 2
 *
 * Historical Simulation VaR:
 *   - Uses last 252 trading days of daily returns for each symbol
 *   - Weights by position size
 *   - Sorts combined portfolio daily P&L scenarios
 *   - 95th percentile loss is the 1-day 95% VaR
 *
 * The daily returns array is pre-warmed in memory at startup — zero hot-path I/O.
 *
 * Binary search on qty scale to find the largest qty that keeps
 * portfolio VaR below the limit.
 */

import { PortfolioSnapshot } from '../types';

export interface VaRCheckInput {
  new_symbol_id: string;
  new_qty: number;
  new_entry_price: number;
  portfolio: PortfolioSnapshot;
  max_portfolio_var_pct: number;    // e.g. 0.04 (4%)
  var_limit_multiplier: number;     // from Stage 0 context
}

export interface VaRResult {
  passed: boolean;
  adjusted_qty: number;
  var_1d_95_pct: number;          // portfolio VaR as % of portfolio value
  var_limit_pct: number;          // effective limit after multiplier
  detail: string;
}

export class PortfolioVaR {
  /** symbol_id → last 252 daily returns (decimal, ordered oldest→newest) */
  private readonly returnsSeries: Map<string, number[]> = new Map();

  hydrate(symbol_id: string, returns: number[]): void {
    this.returnsSeries.set(symbol_id, returns.slice(-252));
  }

  check(input: VaRCheckInput): VaRResult {
    const { new_symbol_id, new_qty, new_entry_price, portfolio, max_portfolio_var_pct, var_limit_multiplier } = input;

    const effective_limit = max_portfolio_var_pct * var_limit_multiplier;
    const portfolio_value = portfolio.total_portfolio_value;

    if (portfolio_value <= 0) {
      return {
        passed: true,
        adjusted_qty: new_qty,
        var_1d_95_pct: 0,
        var_limit_pct: effective_limit,
        detail: 'Zero portfolio value — VaR check skipped',
      };
    }

    // If no historical data for symbol, use a conservative 2% single-day estimate
    const newReturns = this.returnsSeries.get(new_symbol_id) ?? Array(252).fill(-0.02);

    // Build scenarios: sum of (position_value × return) for each day
    const nDays = 252;
    const scenarios = new Array<number>(nDays).fill(0);

    // Existing positions
    for (const pos of portfolio.positions) {
      const returns = this.returnsSeries.get(pos.symbol_id);
      if (!returns) continue;
      const weight = pos.market_value;
      for (let i = 0; i < nDays; i++) {
        scenarios[i] += weight * (returns[i] ?? -0.02);
      }
    }

    // Binary search: find max qty such that portfolio VaR ≤ limit
    const calcVaRWithQty = (qty: number): number => {
      const newValue = qty * new_entry_price;
      const combined = scenarios.map((s, i) => s + newValue * (newReturns[i] ?? -0.02));
      combined.sort((a, b) => a - b);
      const loss_at_95 = -combined[Math.floor(nDays * 0.05)];
      return loss_at_95 / portfolio_value;
    };

    // Fast path: check at requested qty
    const var_at_full_qty = calcVaRWithQty(new_qty);

    if (var_at_full_qty <= effective_limit) {
      return {
        passed: true,
        adjusted_qty: new_qty,
        var_1d_95_pct: var_at_full_qty,
        var_limit_pct: effective_limit,
        detail: `VaR OK: ${(var_at_full_qty * 100).toFixed(2)}% ≤ limit ${(effective_limit * 100).toFixed(2)}%`,
      };
    }

    // Binary search to find max allowed qty
    let lo = 0, hi = new_qty;
    let best_qty = 0;

    for (let iter = 0; iter < 16 && lo <= hi; iter++) {
      const mid = Math.floor((lo + hi) / 2);
      if (mid === 0) break;
      const var_mid = calcVaRWithQty(mid);
      if (var_mid <= effective_limit) {
        best_qty = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const final_var = best_qty > 0 ? calcVaRWithQty(best_qty) : 0;

    return {
      passed: best_qty > 0,
      adjusted_qty: best_qty,
      var_1d_95_pct: final_var,
      var_limit_pct: effective_limit,
      detail: `VaR reduced: requested_qty=${new_qty} → adjusted_qty=${best_qty} var=${(final_var * 100).toFixed(2)}% limit=${(effective_limit * 100).toFixed(2)}%`,
    };
  }
}
