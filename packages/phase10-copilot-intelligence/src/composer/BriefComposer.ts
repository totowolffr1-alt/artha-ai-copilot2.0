/**
 * packages/phase10-copilot-intelligence/src/composer/BriefComposer.ts
 * Artha AI — Phase 10 Brief & Digest Composer
 *
 * Generates the daily morning brief and on-demand plain-English summaries.
 */

import { MarketRegime } from '../types';

export interface DailyBriefData {
  regime:          MarketRegime;
  vix_level:       number;
  portfolio_heat:  number;    // 0–1
  open_positions:  number;
  yesterday_pnl:   number;
  week_wins:       number;
  week_losses:     number;
  high_conf_setups: Array<{ symbol: string; direction: string; score: number }>;
  kill_switch_active: boolean;
}

export interface WeeklyDigestData {
  total_trades:   number;
  wins:           number;
  losses:         number;
  gross_pnl:      number;
  total_fees:     number;
  net_pnl:        number;
  best_pattern:   string;
  worst_pattern:  string;
  avg_win:        number;
  avg_loss:       number;
}

export class BriefComposer {
  /**
   * Compose the 09:15 IST morning brief as a formatted string.
   */
  composeDailyBrief(data: DailyBriefData): string {
    const pnlSign  = data.yesterday_pnl >= 0 ? '+' : '';
    const heatPct  = (data.portfolio_heat * 100).toFixed(0);
    const heatDesc = data.portfolio_heat < 0.4
      ? '(healthy — room to trade)'
      : data.portfolio_heat < 0.7
      ? '(moderate — trade selectively)'
      : '(high — no new positions)';
    const systemStatus = data.kill_switch_active
      ? '🔴 EMERGENCY STOP ACTIVE — No orders possible'
      : '✅ All engines nominal';

    const setupLines = data.high_conf_setups.length > 0
      ? data.high_conf_setups.map(s =>
          `  → ${s.symbol} ${s.direction} — Score ${s.score}/100`
        ).join('\n')
      : '  → No high-confidence setups at this time.';

    const divider = '─'.repeat(45);

    return [
      `📋 ARTHA COPILOT — MORNING BRIEF`,
      divider,
      `Market regime : ${data.regime}`,
      `India VIX     : ${data.vix_level.toFixed(1)}`,
      `Portfolio heat: ${heatPct}% ${heatDesc}`,
      `Open positions: ${data.open_positions}`,
      `Yesterday P&L : ${pnlSign}₹${data.yesterday_pnl.toFixed(2)}`,
      `This week W/R : ${data.week_wins}W / ${data.week_losses}L ` +
        (data.week_wins + data.week_losses > 0
          ? `(${((data.week_wins / (data.week_wins + data.week_losses)) * 100).toFixed(0)}%)`
          : '(no trades yet)'),
      ``,
      `Top setups today:`,
      setupLines,
      ``,
      `System status : ${systemStatus}`,
      divider,
    ].join('\n');
  }

  /**
   * Compose the Friday 15:30 IST weekly performance digest.
   */
  composeWeeklyDigest(data: WeeklyDigestData): string {
    const netSign  = data.net_pnl >= 0 ? '+' : '';
    const winRate  = data.total_trades > 0
      ? `${((data.wins / data.total_trades) * 100).toFixed(0)}%`
      : 'N/A';
    const divider = '─'.repeat(45);

    return [
      `📊 ARTHA COPILOT — WEEKLY PERFORMANCE DIGEST`,
      divider,
      `Total trades  : ${data.total_trades}`,
      `Win / Loss    : ${data.wins}W / ${data.losses}L (${winRate})`,
      `Avg Win       : +₹${data.avg_win.toFixed(2)}`,
      `Avg Loss      : -₹${Math.abs(data.avg_loss).toFixed(2)}`,
      `Gross P&L     : ${data.gross_pnl >= 0 ? '+' : ''}₹${data.gross_pnl.toFixed(2)}`,
      `Total Fees    : -₹${data.total_fees.toFixed(2)}`,
      `Net P&L       : ${netSign}₹${data.net_pnl.toFixed(2)}`,
      ``,
      `Best pattern  : ${data.best_pattern}`,
      `Worst pattern : ${data.worst_pattern}`,
      divider,
    ].join('\n');
  }

  /**
   * Compose a risk warning message when portfolio heat is high.
   */
  composeRiskWarning(heat: number, vix: number): string {
    return [
      `⚠️  ARTHA COPILOT — RISK ALERT`,
      `─────────────────────────────────────────────`,
      `Portfolio heat reached ${(heat * 100).toFixed(0)}% — approaching limit.`,
      vix > 20 ? `India VIX at ${vix.toFixed(1)} (${vix > 25 ? 'HIGH VOLATILITY' : 'CAUTION'} zone).` : '',
      `Recommendation: No new positions until heat falls below 70%.`,
      `─────────────────────────────────────────────`,
    ].filter(Boolean).join('\n');
  }
}
