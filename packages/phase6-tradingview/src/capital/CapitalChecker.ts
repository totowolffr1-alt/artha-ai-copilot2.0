/**
 * packages/phase6-tradingview/src/capital/CapitalChecker.ts
 * Artha AI — Phase 6 Risk Engine — Stage 1
 *
 * Verifies cash availability and position count limits.
 * Simple final gate before exposure checks.
 */

import { PortfolioSnapshot, RiskConfig, MarketRiskContext } from '../types';

export interface CapitalCheckResult {
  passed: boolean;
  reason?: string;
  cash_available: number;
  required_capital: number;
  open_trade_count: number;
  max_open_trades: number;
  detail: string;
}

export class CapitalChecker {
  check(
    qty: number,
    entry_price: number,
    portfolio: PortfolioSnapshot,
    cfg: RiskConfig,
    context: MarketRiskContext,
  ): CapitalCheckResult {
    const required_capital = qty * entry_price;
    const max_open_trades = Math.min(cfg.max_open_trades, context.max_positions_override);

    // Position count gate
    if (portfolio.open_trade_count >= max_open_trades) {
      return {
        passed: false,
        reason: `Max open trades reached: ${portfolio.open_trade_count}/${max_open_trades} (market_state=${context.market_state})`,
        cash_available: portfolio.cash_available,
        required_capital,
        open_trade_count: portfolio.open_trade_count,
        max_open_trades,
        detail: `open_trades=${portfolio.open_trade_count} limit=${max_open_trades}`,
      };
    }

    // Cash gate
    if (portfolio.cash_available < required_capital) {
      return {
        passed: false,
        reason: `Insufficient cash: need ₹${required_capital.toFixed(0)}, have ₹${portfolio.cash_available.toFixed(0)}`,
        cash_available: portfolio.cash_available,
        required_capital,
        open_trade_count: portfolio.open_trade_count,
        max_open_trades,
        detail: `cash=${portfolio.cash_available.toFixed(0)} required=${required_capital.toFixed(0)}`,
      };
    }

    return {
      passed: true,
      cash_available: portfolio.cash_available,
      required_capital,
      open_trade_count: portfolio.open_trade_count,
      max_open_trades,
      detail: `cash OK: ₹${portfolio.cash_available.toFixed(0)} available, need ₹${required_capital.toFixed(0)}`,
    };
  }
}
