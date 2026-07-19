/**
 * packages/phase6-tradingview/src/exposure/ExposureManager.ts
 * Artha AI — Phase 6 Risk Engine — Stage 1
 *
 * Checks and enforces stock and sector concentration limits.
 * If new_qty × price would breach a limit, it scales down qty to the max
 * allowed rather than rejecting outright (gives Stage 1 a reduction path).
 */

import { PortfolioSnapshot, OpenPosition, RiskConfig } from '../types';
import { SectorMapper } from './SectorMapper';

export interface ExposureCheckResult {
  passed: boolean;
  adjusted_qty: number;
  stock_exposure_pct_before: number;
  stock_exposure_pct_after: number;
  sector_exposure_pct_after: number;
  net_long_pct_after: number;
  binding_limit: 'stock' | 'sector' | 'net_long' | 'none';
  detail: string;
}

export class ExposureManager {
  constructor(private readonly sectorMapper: SectorMapper) {}

  check(
    symbol_id: string,
    ticker: string,
    qty: number,
    entry_price: number,
    portfolio: PortfolioSnapshot,
    cfg: RiskConfig,
  ): ExposureCheckResult {
    const portfolio_value = portfolio.total_portfolio_value;
    if (portfolio_value <= 0) {
      return this.reject(qty, 'Zero portfolio value');
    }

    const sector = this.sectorMapper.getSector(ticker);
    const new_position_value = qty * entry_price;

    // Current stock exposure
    const existing_position = portfolio.positions.find(p => p.symbol_id === symbol_id);
    const current_stock_value = existing_position ? existing_position.market_value : 0;
    const stock_exposure_before_pct = current_stock_value / portfolio_value;

    // If adding new_position_value, what would stock exposure be?
    const stock_exposure_after = (current_stock_value + new_position_value) / portfolio_value;

    // Current sector exposure
    const sector_positions = portfolio.positions.filter(p =>
      this.sectorMapper.getSector(p.ticker) === sector
    );
    const current_sector_value = sector_positions.reduce((sum, p) => sum + p.market_value, 0);
    const sector_exposure_after = (current_sector_value + new_position_value) / portfolio_value;

    // Net long exposure
    const current_net_long = portfolio.positions
      .filter(p => p.direction === 'LONG')
      .reduce((sum, p) => sum + p.market_value, 0);
    const net_long_pct_after = (current_net_long + new_position_value) / portfolio_value;

    // Find binding constraint and scale down qty if needed
    let adjusted_qty = qty;
    let binding_limit: ExposureCheckResult['binding_limit'] = 'none';

    // Stock limit
    if (stock_exposure_after > cfg.max_stock_pct) {
      const max_new_value = Math.max(0, cfg.max_stock_pct * portfolio_value - current_stock_value);
      const max_qty = entry_price > 0 ? Math.floor(max_new_value / entry_price) : 0;
      if (max_qty < adjusted_qty) {
        adjusted_qty = max_qty;
        binding_limit = 'stock';
      }
    }

    // Sector limit
    if (sector_exposure_after > cfg.max_sector_pct) {
      const max_new_sector_value = Math.max(0, cfg.max_sector_pct * portfolio_value - current_sector_value);
      const max_qty = entry_price > 0 ? Math.floor(max_new_sector_value / entry_price) : 0;
      if (max_qty < adjusted_qty) {
        adjusted_qty = max_qty;
        binding_limit = 'sector';
      }
    }

    // Net long cap
    if (net_long_pct_after > cfg.max_net_long_pct) {
      const max_new_long_value = Math.max(0, cfg.max_net_long_pct * portfolio_value - current_net_long);
      const max_qty = entry_price > 0 ? Math.floor(max_new_long_value / entry_price) : 0;
      if (max_qty < adjusted_qty) {
        adjusted_qty = max_qty;
        binding_limit = 'net_long';
      }
    }

    const final_qty = Math.max(0, adjusted_qty);
    const final_value = final_qty * entry_price;

    const detail = `stock_before=${(stock_exposure_before_pct * 100).toFixed(2)}% stock_after=${((current_stock_value + final_value) / portfolio_value * 100).toFixed(2)}% sector=${sector} sector_after=${((current_sector_value + final_value) / portfolio_value * 100).toFixed(2)}% binding=${binding_limit}`;

    return {
      passed: final_qty >= cfg.min_tradeable_qty,
      adjusted_qty: final_qty,
      stock_exposure_pct_before: stock_exposure_before_pct,
      stock_exposure_pct_after: (current_stock_value + final_value) / portfolio_value,
      sector_exposure_pct_after: (current_sector_value + final_value) / portfolio_value,
      net_long_pct_after: (current_net_long + final_value) / portfolio_value,
      binding_limit,
      detail,
    };
  }

  private reject(qty: number, reason: string): ExposureCheckResult {
    return {
      passed: false,
      adjusted_qty: 0,
      stock_exposure_pct_before: 0,
      stock_exposure_pct_after: 0,
      sector_exposure_pct_after: 0,
      net_long_pct_after: 0,
      binding_limit: 'none',
      detail: reason,
    };
  }
}
