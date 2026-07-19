/**
 * packages/phase6-tradingview/src/sizer/PositionSizer.ts
 * Artha AI — Phase 6 Risk Engine — Stage 1
 *
 * Computes a base quantity from:
 *   - Kelly fraction (from Phase 5 signal)
 *   - ATR-based risk sizing (% of capital at risk per trade)
 *   - Market risk budget multiplier (from Stage 0)
 *
 * Zero DB I/O. All inputs are pre-computed.
 */

export interface PositionSizerInputs {
  available_capital: number;     // Cash available in portfolio
  entry_price: number;           // Signal's entry price hint
  stop_loss: number | null;      // Absolute SL price (null = use ATR fallback)
  atr: number;                   // ATR of the symbol (from signal features)
  atr_fallback_multiplier: number; // e.g. 2.0 — used when SL is null
  kelly_fraction: number;        // [0, 1]
  conviction: number;            // [0, 1] — from ConvictionScorer
  max_risk_per_trade_pct: number;  // e.g. 0.01 (1%)
  max_capital_per_trade_pct: number; // e.g. 0.10 (10%)
  risk_budget_multiplier: number;  // [0, 1] — from Stage 0
  min_tradeable_qty: number;       // e.g. 1
}

export interface PositionSizerResult {
  qty: number;
  capital_allocated: number;
  risk_amount: number;
  effective_sl_distance: number;
  method: 'atr_risk' | 'kelly_cap' | 'capital_cap';
  detail: string;
}

export class PositionSizer {
  /**
   * Sizing algorithm:
   *   1. Compute SL distance (entry - sl) or (atr × multiplier)
   *   2. ATR risk method: qty = (capital × max_risk_pct × multiplier × conviction) / sl_distance
   *   3. Kelly cap: qty = capital × kelly_fraction × multiplier / entry
   *   4. Capital cap: qty ≤ capital × max_capital_pct / entry
   *   5. Final qty = min(atr_risk_qty, kelly_qty, capital_qty)
   */
  size(inputs: PositionSizerInputs): PositionSizerResult {
    const {
      available_capital, entry_price, stop_loss, atr,
      atr_fallback_multiplier, kelly_fraction, conviction,
      max_risk_per_trade_pct, max_capital_per_trade_pct,
      risk_budget_multiplier, min_tradeable_qty,
    } = inputs;

    // Step 1: SL distance
    const sl_distance = stop_loss !== null
      ? Math.abs(entry_price - stop_loss)
      : atr * atr_fallback_multiplier;

    if (sl_distance <= 0 || entry_price <= 0 || available_capital <= 0) {
      return {
        qty: 0,
        capital_allocated: 0,
        risk_amount: 0,
        effective_sl_distance: sl_distance,
        method: 'atr_risk',
        detail: 'Zero qty: invalid price or capital inputs',
      };
    }

    // Step 2: ATR risk qty
    const risk_capital = available_capital * max_risk_per_trade_pct * risk_budget_multiplier * conviction;
    const atr_risk_qty = Math.floor(risk_capital / sl_distance);

    // Step 3: Kelly cap qty
    const kelly_qty = Math.floor(
      (available_capital * kelly_fraction * risk_budget_multiplier) / entry_price
    );

    // Step 4: Capital cap qty
    const capital_cap_qty = Math.floor(
      (available_capital * max_capital_per_trade_pct) / entry_price
    );

    // Step 5: Take the minimum of all three
    const raw_qty = Math.min(atr_risk_qty, kelly_qty, capital_cap_qty);
    const qty = Math.max(0, raw_qty);

    // Determine which constraint was binding
    let method: PositionSizerResult['method'];
    if (raw_qty === capital_cap_qty) method = 'capital_cap';
    else if (raw_qty === kelly_qty) method = 'kelly_cap';
    else method = 'atr_risk';

    const final_qty = qty >= min_tradeable_qty ? qty : 0;
    const capital_allocated = final_qty * entry_price;
    const risk_amount = final_qty * sl_distance;

    const detail = `atr_risk_qty=${atr_risk_qty} kelly_qty=${kelly_qty} cap_qty=${capital_cap_qty} → final=${final_qty} method=${method}`;

    return {
      qty: final_qty,
      capital_allocated,
      risk_amount,
      effective_sl_distance: sl_distance,
      method,
      detail,
    };
  }
}
