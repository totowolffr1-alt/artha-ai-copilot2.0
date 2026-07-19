/**
 * packages/phase10-copilot-intelligence/src/conversation/QueryHandler.ts
 * Artha AI — Phase 10 Query Handler
 *
 * Routes natural language questions to the correct data source
 * and returns a plain-English copilot response.
 *
 * Supported queries (template-driven, no LLM costs):
 *   - Why was [SYMBOL] rejected?
 *   - What is my drawdown?
 *   - Show open positions
 *   - Daily summary / today's summary
 *   - Show suppressed signals
 *   - What is my win rate?
 *   - What is the market regime?
 *   - Watch [SYMBOL]
 *   - Unwatch [SYMBOL]
 *   - Show watchlist
 */

import { QueryIntent } from '../types';
import { WatchlistManager } from '../watchlist/WatchlistManager';

export interface SignalAuditRecord {
  symbol:        string;
  status:        string;
  rejection_reason?: string;
  confidence:    number;
  regime:        string;
  created_at:    Date;
}

export interface DrawdownRecord {
  drawdown_pct:    number;
  hwm_value:       number;
  portfolio_value: number;
  recorded_at:     Date;
}

export interface PositionRecord {
  symbol:        string;
  direction:     string;
  qty:           number;
  entry_price:   number;
  ltp:           number;
  unrealised_pnl: number;
}

export interface WinRateRecord {
  total_trades:  number;
  wins:          number;
  losses:        number;
  win_rate:      number;
}

export interface IQueryDataSource {
  getSignalAudit(symbol?: string, status?: string): Promise<SignalAuditRecord[]>;
  getLatestDrawdown(): Promise<DrawdownRecord | null>;
  getOpenPositions(): Promise<PositionRecord[]>;
  getWinRate(days: number): Promise<WinRateRecord>;
  getCurrentRegime(): Promise<string>;
}

export class QueryHandler {
  constructor(
    private readonly dataSource: IQueryDataSource,
    private readonly watchlist:  WatchlistManager
  ) {}

  async handle(input: string): Promise<string> {
    const lower   = input.toLowerCase().trim();
    const intent  = this._detectIntent(lower);
    const symbol  = this._extractSymbol(input);

    switch (intent) {
      case 'WHY_REJECTED':
        return this._handleWhyRejected(symbol);

      case 'DRAWDOWN_STATUS':
        return this._handleDrawdown();

      case 'OPEN_POSITIONS':
        return this._handleOpenPositions();

      case 'DAILY_SUMMARY':
        return this._handleDailySummary();

      case 'SUPPRESSED_SIGNALS':
        return this._handleSuppressedSignals();

      case 'WIN_RATE':
        return this._handleWinRate();

      case 'REGIME_STATUS':
        return this._handleRegime();

      case 'WATCHLIST_ADD':
        return this._handleWatchlistAdd(symbol, input);

      case 'WATCHLIST_REMOVE':
        return this._handleWatchlistRemove(symbol);

      default:
        return this._handleUnknown(input);
    }
  }

  private _detectIntent(lower: string): QueryIntent {
    if (lower.includes('why') && (lower.includes('reject') || lower.includes('suppress') || lower.includes('block')))
      return 'WHY_REJECTED';
    if (lower.includes('drawdown') || lower.includes('loss') && lower.includes('max'))
      return 'DRAWDOWN_STATUS';
    if (lower.includes('position') || lower.includes('open trade'))
      return 'OPEN_POSITIONS';
    if (lower.includes('today') || lower.includes('daily') || lower.includes('summary'))
      return 'DAILY_SUMMARY';
    if (lower.includes('suppress'))
      return 'SUPPRESSED_SIGNALS';
    if (lower.includes('win rate') || lower.includes('accuracy') || lower.includes('performance'))
      return 'WIN_RATE';
    if (lower.includes('regime') || lower.includes('market') && lower.includes('condition'))
      return 'REGIME_STATUS';
    if (lower.startsWith('watch ') && !lower.includes('unwatch'))
      return 'WATCHLIST_ADD';
    if (lower.startsWith('unwatch ') || lower.includes('remove') && lower.includes('watch'))
      return 'WATCHLIST_REMOVE';
    if (lower.includes('watchlist'))
      return 'WATCHLIST_ADD'; // show watchlist on bare "watchlist" query

    return 'UNKNOWN';
  }

  private _extractSymbol(input: string): string | undefined {
    // Match uppercase stock symbols (2–12 uppercase letters)
    const match = input.match(/\b([A-Z]{2,12})\b/);
    return match?.[1];
  }

  private async _handleWhyRejected(symbol?: string): Promise<string> {
    const records = await this.dataSource.getSignalAudit(symbol, 'rejected');
    if (records.length === 0)
      return symbol
        ? `No rejected signals found for ${symbol} today.`
        : `No rejected signals found today.`;

    const latest = records[0];
    return [
      `🔍 Signal Audit — ${latest.symbol}`,
      `─────────────────────────────────────────────`,
      `Status    : ${latest.status.toUpperCase()}`,
      `Regime    : ${latest.regime}`,
      `Confidence: ${(latest.confidence * 100).toFixed(1)}%`,
      `Reason    : ${latest.rejection_reason ?? 'No specific reason recorded.'}`,
      `Time      : ${latest.created_at.toLocaleTimeString('en-IN')}`,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  private async _handleDrawdown(): Promise<string> {
    const dd = await this.dataSource.getLatestDrawdown();
    if (!dd) return `No drawdown records found. Start trading to track portfolio health.`;

    const ddPct = (dd.drawdown_pct * 100).toFixed(2);
    const sentiment = dd.drawdown_pct > -0.05
      ? '✅ Healthy — within normal range.'
      : dd.drawdown_pct > -0.10
      ? '⚠️ Moderate — watch closely.'
      : '🔴 Significant — consider reducing exposure.';

    return [
      `📊 Portfolio Drawdown`,
      `─────────────────────────────────────────────`,
      `Current Drawdown : ${ddPct}% from HWM`,
      `Portfolio Value  : ₹${dd.portfolio_value.toFixed(2)}`,
      `High Water Mark  : ₹${dd.hwm_value.toFixed(2)}`,
      `Assessment       : ${sentiment}`,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  private async _handleOpenPositions(): Promise<string> {
    const positions = await this.dataSource.getOpenPositions();
    if (positions.length === 0) return `📋 No open positions right now.`;

    const lines = positions.map(p => {
      const pnlSign = p.unrealised_pnl >= 0 ? '+' : '';
      return `  • ${p.symbol} ${p.direction} | Qty: ${p.qty} | Entry: ₹${p.entry_price.toFixed(2)} | LTP: ₹${p.ltp.toFixed(2)} | P&L: ${pnlSign}₹${p.unrealised_pnl.toFixed(2)}`;
    });

    return [
      `📋 Open Positions (${positions.length})`,
      `─────────────────────────────────────────────`,
      ...lines,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  private async _handleDailySummary(): Promise<string> {
    const [wr, regime, positions] = await Promise.all([
      this.dataSource.getWinRate(1),
      this.dataSource.getCurrentRegime(),
      this.dataSource.getOpenPositions(),
    ]);

    return [
      `📋 Today's Summary`,
      `─────────────────────────────────────────────`,
      `Market Regime  : ${regime}`,
      `Open Positions : ${positions.length}`,
      `Trades Today   : ${wr.total_trades}`,
      `Win / Loss     : ${wr.wins}W / ${wr.losses}L`,
      `Win Rate       : ${(wr.win_rate * 100).toFixed(0)}%`,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  private async _handleSuppressedSignals(): Promise<string> {
    const records = await this.dataSource.getSignalAudit(undefined, 'suppressed');
    if (records.length === 0) return `No suppressed signals found today.`;

    const lines = records.slice(0, 5).map(r =>
      `  • ${r.symbol} — ${r.rejection_reason ?? 'No reason'} (${r.created_at.toLocaleTimeString('en-IN')})`
    );
    return [
      `🚫 Suppressed Signals Today (${records.length})`,
      `─────────────────────────────────────────────`,
      ...lines,
      records.length > 5 ? `  ... and ${records.length - 5} more.` : '',
      `─────────────────────────────────────────────`,
    ].filter(Boolean).join('\n');
  }

  private async _handleWinRate(): Promise<string> {
    const [wr7, wr30] = await Promise.all([
      this.dataSource.getWinRate(7),
      this.dataSource.getWinRate(30),
    ]);

    return [
      `📈 Performance Summary`,
      `─────────────────────────────────────────────`,
      `Last 7 days  : ${wr7.wins}W / ${wr7.losses}L — ${(wr7.win_rate * 100).toFixed(0)}% win rate`,
      `Last 30 days : ${wr30.wins}W / ${wr30.losses}L — ${(wr30.win_rate * 100).toFixed(0)}% win rate`,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  private async _handleRegime(): Promise<string> {
    const regime = await this.dataSource.getCurrentRegime();
    const advice: Record<string, string> = {
      STRONG_BULL:    'Good time to hold longs. Momentum is your friend.',
      BULL:           'Cautiously bullish. Look for dips to enter.',
      NEUTRAL:        'Choppy conditions. Trade selectively with tight stops.',
      CAUTION:        'Be defensive. Reduce position sizes.',
      HIGH_VOLATILITY:'High risk. Wide ATR — only high R:R setups.',
      CRASH:          'Do NOT trade. Preserve capital.',
    };
    return [
      `🌐 Current Market Regime: ${regime}`,
      `─────────────────────────────────────────────`,
      `Advice : ${advice[regime] ?? 'Monitor the market closely.'}`,
      `─────────────────────────────────────────────`,
    ].join('\n');
  }

  private _handleWatchlistAdd(symbol?: string, raw?: string): string {
    if (!symbol) return this.watchlist.describe();
    const note = raw?.replace(/watch\s+\w+\s*/i, '').trim() || undefined;
    const entry = this.watchlist.watch(symbol, note || undefined);
    return `👁️ Now watching ${entry.symbol}. I'll alert you at ${(entry.min_confidence * 100).toFixed(0)}%+ confidence setups.${note ? ` Note: "${note}".` : ''}`;
  }

  private _handleWatchlistRemove(symbol?: string): string {
    if (!symbol) return `Please specify a symbol to unwatch. E.g., "unwatch RELIANCE"`;
    const removed = this.watchlist.unwatch(symbol);
    return removed
      ? `✅ Removed ${symbol.toUpperCase()} from watchlist.`
      : `${symbol.toUpperCase()} was not on your watchlist.`;
  }

  private _handleUnknown(input: string): string {
    return [
      `🤖 I didn't quite understand that. Here's what I can help with:`,
      ``,
      `  • "Why was NIFTY rejected?"`,
      `  • "What is my drawdown?"`,
      `  • "Show open positions"`,
      `  • "Today's summary"`,
      `  • "What is my win rate?"`,
      `  • "What is the market regime?"`,
      `  • "Watch RELIANCE" / "Unwatch RELIANCE"`,
      `  • "Show watchlist"`,
    ].join('\n');
  }
}
