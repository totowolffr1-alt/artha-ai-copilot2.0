/**
 * packages/phase7-broker/src/protection/TransactionCostFilter.ts
 * Artha AI — Phase 7 Capital Protection — Transaction Cost Filter
 *
 * Estimates all trading friction (brokerage, STT, GST, SEBI fee, stamp duty, spread slippage)
 * and blocks orders if they consume too much of the target profit.
 *
 * Keeps personal/retail accounts from trading illiquid or high-fee setups.
 */

export interface CostFilterInput {
  qty: number;
  entry_price: number;
  take_profit: number | null;
  bid: number;
  ask: number;
  is_intraday: boolean;
  max_friction_pct_of_profit: number; // e.g., 0.05 (5%)
}

export interface CostCheckResult {
  passed: boolean;
  total_cost: number;
  spread_slippage_cost: number;
  taxes_fees_cost: number;
  target_profit: number;
  cost_ratio: number;
  detail: string;
}

export class TransactionCostFilter {
  /**
   * Enforces capital friction rules:
   *   1. Target profit = qty × |entry - take_profit| (fallback: 5% of turnover if take_profit is null)
   *   2. Taxes & Fees = brokerage + exchange_charges + STT + GST + stamp_duty + SEBI fee
   *   3. Spread slippage cost = qty × (ask - bid) / 2
   *   4. Total cost = Taxes & Fees + Spread slippage cost
   *   5. Reject if Total cost > Target profit × max_friction_pct_of_profit
   */
  check(input: CostFilterInput): CostCheckResult {
    const { qty, entry_price, take_profit, bid, ask, is_intraday, max_friction_pct_of_profit } = input;

    const turnover = qty * entry_price;
    if (turnover <= 0) {
      return { passed: false, total_cost: 0, spread_slippage_cost: 0, taxes_fees_cost: 0, target_profit: 0, cost_ratio: 0, detail: 'Zero turnover' };
    }

    // 1. Target profit estimation
    let target_profit = 0;
    if (take_profit !== null && take_profit > 0) {
      target_profit = qty * Math.abs(take_profit - entry_price);
    } else {
      // Fallback: estimate a conservative 5% move target
      target_profit = turnover * 0.05;
    }

    // 2. Brokerage (flat ₹20 or 0.05% of turnover, whichever is lower)
    const brokerage = Math.min(20, turnover * 0.0005) * 2; // buy + sell estimation

    // 3. Exchange Transaction Charges (NSE equity delivery/intraday: ~0.00343% of turnover)
    const exchange_charges = turnover * 0.0000343 * 2;

    // 4. STT (Securities Transaction Tax)
    // Delivery: 0.1% on buy & sell. Intraday: 0.025% on sell only.
    const stt = is_intraday
      ? turnover * 0.00025 // sell only
      : turnover * 0.001 * 2; // buy + sell

    // 5. GST (18% on Brokerage + Exchange charges)
    const gst = (brokerage + exchange_charges) * 0.18;

    // 6. SEBI Turnover Fee (0.0001% of turnover)
    const sebi_fee = turnover * 0.000001 * 2;

    // 7. Stamp Duty (Delivery buy only: 0.015%. Intraday buy only: 0.003%)
    const stamp_duty = is_intraday
      ? turnover * 0.00003
      : turnover * 0.00015;

    const taxes_fees_cost = brokerage + exchange_charges + stt + gst + sebi_fee + stamp_duty;

    // 8. Spread Slippage cost
    const spread = Math.max(0, ask - bid);
    const spread_slippage_cost = qty * (spread / 2);

    const total_cost = taxes_fees_cost + spread_slippage_cost;
    const cost_ratio = target_profit > 0 ? total_cost / target_profit : 1.0;

    const passed = cost_ratio <= max_friction_pct_of_profit;

    const detail = `target_profit=₹${target_profit.toFixed(0)} total_fees=₹${taxes_fees_cost.toFixed(1)} slippage=₹${spread_slippage_cost.toFixed(1)} ratio=${(cost_ratio * 100).toFixed(2)}% limit=${(max_friction_pct_of_profit * 100).toFixed(1)}%`;

    return {
      passed,
      total_cost,
      spread_slippage_cost,
      taxes_fees_cost,
      target_profit,
      cost_ratio,
      detail,
    };
  }
}
