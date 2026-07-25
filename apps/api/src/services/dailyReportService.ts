/**
 * dailyReportService.ts — Phase 19: Autonomous Trading Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Daily 15:45 IST P&L Report Generator & Multi-Channel Dispatcher.
 */

import { capitalVault } from '../../../../packages/phase5-strategy/src/vault/CapitalVault';
import { TradeJournalService } from './tradeJournalService';
import { pushNotification } from './notificationService';

export interface DailyReport {
  date: string;
  allocatedCapital: number;
  availableCapital: number;
  todayPnL: number;
  todayPnLPct: number;
  weekPnL: number;
  monthPnL: number;
  totalPnL: number;
  tradesTodayCount: number;
  winningTradesCount: number;
  losingTradesCount: number;
  winRate30d: number;
  sharpeRatio30d: number;
  maxDrawdownPct: number;
  drawdownFromPeakPct: number;
  vaultState: string;
  vaultMode: string;
  formattedText: string;
}

/**
 * Generate a comprehensive daily report object and formatted Markdown string.
 */
export async function generateDailyReport(): Promise<DailyReport> {
  const vaultStatus = capitalVault.getStatus();
  const metrics = TradeJournalService.getPerformanceMetrics();
  const allTrades = TradeJournalService.getJournal(100);
  const todayDateStr = new Date().toISOString().split('T')[0];
  const tradesToday = allTrades.filter(t => t.entry_time.startsWith(todayDateStr));

  const winningTrades = tradesToday.filter(t => (t.net_pnl || 0) > 0).length;
  const losingTrades = tradesToday.filter(t => (t.net_pnl || 0) < 0).length;
  const todayPnLPct = vaultStatus.allocatedCapital > 0
    ? (vaultStatus.todayPnL / vaultStatus.allocatedCapital) * 100
    : 0;

  const todayStr = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const pnlEmoji = vaultStatus.todayPnL >= 0 ? '🟢' : '🔴';
  const sign = vaultStatus.todayPnL >= 0 ? '+' : '';

  const tradeBreakdownLines = tradesToday.length > 0
    ? tradesToday.map(t => {
        const icon = t.net_pnl >= 0 ? '✅' : '❌';
        const pnlSign = t.net_pnl >= 0 ? '+' : '';
        return `  ${icon} ${t.symbol} ${t.direction} ${pnlSign}₹${t.net_pnl.toFixed(2)} (${t.exit_reason || 'CLOSED'})`;
      }).join('\n')
    : '  • No trades executed today.';

  const text = [
    `📊 **Artha AI Copilot — Daily Performance Briefing**`,
    `Date: ${todayStr}`,
    `──────────────────────────────────────────────`,
    `Allocated Capital : ₹${vaultStatus.allocatedCapital.toLocaleString('en-IN')}`,
    `Available Capital : ₹${vaultStatus.availableCapital.toLocaleString('en-IN')}`,
    `Today's P&L       : ${pnlEmoji} **${sign}₹${vaultStatus.todayPnL.toFixed(2)}** (${sign}${todayPnLPct.toFixed(2)}%)`,
    `Week P&L          : ₹${vaultStatus.weekPnL.toFixed(2)}`,
    `Month P&L         : ₹${vaultStatus.monthPnL.toFixed(2)}`,
    `──────────────────────────────────────────────`,
    `Trades Today (${tradesToday.length}):`,
    tradeBreakdownLines,
    `──────────────────────────────────────────────`,
    `30-Day Win Rate    : **${metrics.winRatePct.toFixed(1)}%**`,
    `30-Day Sharpe Ratio: **${metrics.sharpeRatio.toFixed(2)}**`,
    `Max Drawdown       : **${metrics.maxDrawdownPct.toFixed(2)}%**`,
    `Drawdown from Peak : **${vaultStatus.drawdownFromPeak.toFixed(2)}%**`,
    `──────────────────────────────────────────────`,
    `Vault Status      : **${vaultStatus.state}** (${vaultStatus.mode} Mode)`,
    `System Health     : 🟢 ACTIVE — Institutional Risk Guard Active`,
  ].join('\n');

  return {
    date: todayStr,
    allocatedCapital: vaultStatus.allocatedCapital,
    availableCapital: vaultStatus.availableCapital,
    todayPnL: vaultStatus.todayPnL,
    todayPnLPct: Math.round(todayPnLPct * 100) / 100,
    weekPnL: vaultStatus.weekPnL,
    monthPnL: vaultStatus.monthPnL,
    totalPnL: vaultStatus.totalPnL,
    tradesTodayCount: tradesToday.length,
    winningTradesCount: winningTrades,
    losingTradesCount: losingTrades,
    winRate30d: metrics.winRatePct,
    sharpeRatio30d: metrics.sharpeRatio,
    maxDrawdownPct: metrics.maxDrawdownPct,
    drawdownFromPeakPct: vaultStatus.drawdownFromPeak,
    vaultState: vaultStatus.state,
    vaultMode: vaultStatus.mode,
    formattedText: text,
  };
}

/**
 * Dispatch the daily report via push notifications and Telegram (if TELEGRAM_BOT_TOKEN set).
 */
export async function dispatchDailyReport(): Promise<DailyReport> {
  const report = await generateDailyReport();

  // 1. Browser Push Notification
  const pnlSign = report.todayPnL >= 0 ? '+' : '';
  await pushNotification({
    component: 'DailyReport',
    severity: report.todayPnL >= 0 ? 'INFO' : 'WARNING',
    title: `📋 Daily P&L: ${pnlSign}₹${report.todayPnL.toFixed(2)} (${pnlSign}${report.todayPnLPct}%)`,
    message: `Allocated: ₹${report.allocatedCapital.toLocaleString()} | Trades: ${report.tradesTodayCount} | Win Rate: ${report.winRate30d}%`,
  });

  // 2. Telegram Bot Dispatch (if credentials configured)
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && chatId) {
    try {
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: report.formattedText,
          parse_mode: 'Markdown',
        }),
      });
      console.log('[DailyReport] ✅ Report dispatched to Telegram channel.');
    } catch (err: any) {
      console.error('[DailyReport] Telegram dispatch failed:', err?.message);
    }
  }

  console.log('[DailyReport] Daily briefing generated successfully.');
  return report;
}
