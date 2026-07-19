/**
 * packages/phase10-copilot-intelligence/src/__tests__/Copilot.test.ts
 * Artha AI — Phase 10 Unit Tests
 */

import { OpportunityScorer }  from '../engine/OpportunityScorer';
import { MarketHoursGuard }   from '../guards/MarketHoursGuard';
import { AlertCooldownGuard } from '../guards/AlertCooldownGuard';
import { WatchlistManager }   from '../watchlist/WatchlistManager';
import { BriefComposer }      from '../composer/BriefComposer';
import { NotificationBus }    from '../notifications/NotificationBus';
import { QueryHandler }       from '../conversation/QueryHandler';
import { ConversationContext } from '../conversation/ConversationContext';
import { RawOpportunity, CopilotAlert, INotificationChannel } from '../types';
import type { IQueryDataSource } from '../conversation/QueryHandler';

// ─── Helpers ───────────────────────────────────────────────────────────────

function mockOpportunity(overrides: Partial<RawOpportunity> = {}): RawOpportunity {
  return {
    signal_id:          'SIG-001',
    symbol:             'NIFTY',
    direction:          'LONG',
    signal_confidence:  0.80,
    regime:             'STRONG_BULL',
    portfolio_heat:     0.25,
    vix_level:          14.5,
    learned_win_rate:   0.70,
    kill_switch_active: false,
    atr:                95,
    rsi:                34,
    macd:               12,
    macd_signal:        8,
    bb_upper:           22500,
    bb_lower:           21800,
    ltp:                22100,
    kelly_qty:          25,
    stop_price:         21890,
    target_price:       22430,
    signal_created_at:  new Date(),
    ...overrides,
  };
}

function mockDataSource(): IQueryDataSource {
  return {
    getSignalAudit: jest.fn().mockResolvedValue([
      { symbol: 'NIFTY', status: 'rejected', rejection_reason: 'Portfolio heat exceeded limit', confidence: 0.72, regime: 'NEUTRAL', created_at: new Date() }
    ]),
    getLatestDrawdown: jest.fn().mockResolvedValue({
      drawdown_pct: -0.04,
      hwm_value:    500000,
      portfolio_value: 480000,
      recorded_at:  new Date(),
    }),
    getOpenPositions: jest.fn().mockResolvedValue([
      { symbol: 'BANKNIFTY', direction: 'SHORT', qty: 15, entry_price: 47200, ltp: 47050, unrealised_pnl: 2250 }
    ]),
    getWinRate: jest.fn().mockResolvedValue({ total_trades: 10, wins: 7, losses: 3, win_rate: 0.7 }),
    getCurrentRegime: jest.fn().mockResolvedValue('STRONG_BULL'),
  };
}

// ─── 1. OpportunityScorer ────────────────────────────────────────────────────
describe('OpportunityScorer', () => {
  const scorer = new OpportunityScorer();

  test('produces HIGH band for strong setup', () => {
    const scored = scorer.score(mockOpportunity());
    expect(scored.copilot_score).toBeGreaterThanOrEqual(72);
    expect(scored.confidence_band).toBe('HIGH');
    expect(scored.brief).toContain('NIFTY');
    expect(scored.brief).toContain('LONG');
  });

  test('produces LOW band in CRASH regime', () => {
    const scored = scorer.score(mockOpportunity({ regime: 'CRASH', signal_confidence: 0.5 }));
    expect(scored.confidence_band).toBe('LOW');
  });

  test('zeroes safety score when kill switch active', () => {
    const noKill  = scorer.score(mockOpportunity({ kill_switch_active: false }));
    const hasKill = scorer.score(mockOpportunity({ kill_switch_active: true }));
    expect(noKill.copilot_score).toBeGreaterThan(hasKill.copilot_score);
  });

  test('should_notify is false when kill switch active', () => {
    const scored = scorer.score(mockOpportunity({ kill_switch_active: true }));
    expect(scored.should_notify).toBe(false);
  });

  test('detail_lines includes stop and target prices', () => {
    const scored = scorer.score(mockOpportunity());
    const allLines = scored.detail_lines.join(' ');
    expect(allLines).toContain('21890');  // stop
    expect(allLines).toContain('22430');  // target
  });

  test('SHORT overbought reason fires for RSI > 68', () => {
    const scored = scorer.score(mockOpportunity({ direction: 'SHORT', rsi: 74, macd: -5, macd_signal: -2 }));
    expect(scored.brief.toLowerCase()).toContain('overbought');
  });

  test('score is clamped between 0 and 100', () => {
    const scored = scorer.score(mockOpportunity({ signal_confidence: 1.5 })); // >1 edge case
    expect(scored.copilot_score).toBeLessThanOrEqual(100);
    expect(scored.copilot_score).toBeGreaterThanOrEqual(0);
  });
});

// ─── 2. MarketHoursGuard ────────────────────────────────────────────────────
describe('MarketHoursGuard', () => {
  const guard = new MarketHoursGuard();

  function makeIST(hour: number, minute: number): Date {
    // IST = UTC + 5h30m, so UTC = IST - 330 minutes
    const totalISTMinutes = hour * 60 + minute;
    const totalUTCMinutes = totalISTMinutes - 330; // subtract 5h30m
    const utcHour = Math.floor(((totalUTCMinutes % 1440) + 1440) % 1440 / 60);
    const utcMin  = ((totalUTCMinutes % 60) + 60) % 60;
    // 2025-06-03 is a known Tuesday
    const d = new Date(Date.UTC(2025, 5, 3, utcHour, utcMin, 0, 0));
    return d;
  }

  test('09:30 IST Tuesday → market open', () => {
    expect(guard.isMarketOpen(makeIST(9, 30))).toBe(true);
  });

  test('09:00 IST Tuesday → before open', () => {
    expect(guard.isMarketOpen(makeIST(9, 0))).toBe(false);
  });

  test('15:30 IST Tuesday → after close', () => {
    expect(guard.isMarketOpen(makeIST(15, 30))).toBe(false);
  });

  test('Saturday → closed', () => {
    const sat = new Date(Date.UTC(2025, 5, 7, 4, 0)); // Sat 09:30 IST
    expect(guard.isMarketOpen(sat)).toBe(false);
  });

  test('nextOpenDescription returns a string', () => {
    expect(guard.nextOpenDescription()).toContain('IST');
  });
});

// ─── 3. AlertCooldownGuard ───────────────────────────────────────────────────
describe('AlertCooldownGuard', () => {
  test('allows first alert for any symbol', () => {
    const guard = new AlertCooldownGuard(1000);
    expect(guard.canAlert('NIFTY')).toBe(true);
  });

  test('blocks within cooldown window', () => {
    const guard = new AlertCooldownGuard(5000);
    const now = Date.now();
    guard.markAlerted('NIFTY', now);
    expect(guard.canAlert('NIFTY', now + 1000)).toBe(false);
  });

  test('allows after cooldown expires', () => {
    const guard = new AlertCooldownGuard(1000);
    const now = Date.now();
    guard.markAlerted('NIFTY', now);
    expect(guard.canAlert('NIFTY', now + 2000)).toBe(true);
  });

  test('clearAll resets all symbols', () => {
    const guard = new AlertCooldownGuard(60000);
    guard.markAlerted('NIFTY');
    guard.markAlerted('BANKNIFTY');
    guard.clearAll();
    expect(guard.canAlert('NIFTY')).toBe(true);
    expect(guard.canAlert('BANKNIFTY')).toBe(true);
  });

  test('remainingCooldownMs returns 0 for unknown symbols', () => {
    const guard = new AlertCooldownGuard(60000);
    expect(guard.remainingCooldownMs('INFY')).toBe(0);
  });
});

// ─── 4. WatchlistManager ────────────────────────────────────────────────────
describe('WatchlistManager', () => {
  test('adds a symbol to watchlist', () => {
    const wl = new WatchlistManager();
    wl.watch('RELIANCE', 'Expecting breakout');
    expect(wl.isWatched('RELIANCE')).toBe(true);
  });

  test('case-insensitive lookup', () => {
    const wl = new WatchlistManager();
    wl.watch('reliance');
    expect(wl.isWatched('RELIANCE')).toBe(true);
  });

  test('getThreshold returns lower threshold for watched symbol', () => {
    const wl = new WatchlistManager();
    wl.watch('TCS', undefined, 0.55);
    expect(wl.getThreshold('TCS', 0.65)).toBe(0.55);
  });

  test('getThreshold returns global threshold for non-watched symbol', () => {
    const wl = new WatchlistManager();
    expect(wl.getThreshold('WIPRO', 0.65)).toBe(0.65);
  });

  test('unwatch removes symbol', () => {
    const wl = new WatchlistManager();
    wl.watch('HDFC');
    expect(wl.unwatch('HDFC')).toBe(true);
    expect(wl.isWatched('HDFC')).toBe(false);
  });

  test('describe returns empty message when watchlist is empty', () => {
    const wl = new WatchlistManager();
    expect(wl.describe()).toContain('empty');
  });
});

// ─── 5. BriefComposer ───────────────────────────────────────────────────────
describe('BriefComposer', () => {
  const composer = new BriefComposer();

  test('composeDailyBrief contains regime and VIX', () => {
    const brief = composer.composeDailyBrief({
      regime: 'STRONG_BULL', vix_level: 14.2, portfolio_heat: 0.22,
      open_positions: 1, yesterday_pnl: 840, week_wins: 3, week_losses: 1,
      high_conf_setups: [{ symbol: 'NIFTY', direction: 'LONG', score: 81 }],
      kill_switch_active: false,
    });
    expect(brief).toContain('STRONG_BULL');
    expect(brief).toContain('14.2');
    expect(brief).toContain('NIFTY');
  });

  test('composeDailyBrief shows emergency stop when active', () => {
    const brief = composer.composeDailyBrief({
      regime: 'CRASH', vix_level: 30, portfolio_heat: 0.9,
      open_positions: 0, yesterday_pnl: -1200, week_wins: 1, week_losses: 4,
      high_conf_setups: [],
      kill_switch_active: true,
    });
    expect(brief.toUpperCase()).toContain('EMERGENCY STOP');
  });

  test('composeWeeklyDigest contains net P&L', () => {
    const digest = composer.composeWeeklyDigest({
      total_trades: 12, wins: 8, losses: 4,
      gross_pnl: 5000, total_fees: 320, net_pnl: 4680,
      best_pattern: 'MACD Crossover', worst_pattern: 'RSI Reversal',
      avg_win: 750, avg_loss: -400,
    });
    expect(digest).toContain('4680');
    expect(digest).toContain('MACD Crossover');
  });

  test('composeRiskWarning mentions heat percentage', () => {
    const warning = composer.composeRiskWarning(0.82, 23.5);
    expect(warning).toContain('82%');
  });
});

// ─── 6. NotificationBus ─────────────────────────────────────────────────────
describe('NotificationBus', () => {
  test('broadcasts to all registered channels', async () => {
    const ch1: INotificationChannel = { send: jest.fn().mockResolvedValue(undefined) };
    const ch2: INotificationChannel = { send: jest.fn().mockResolvedValue(undefined) };

    const bus = new NotificationBus();
    bus.register(ch1);
    bus.register(ch2);

    const alert: CopilotAlert = {
      type: 'OPPORTUNITY', title: 'Test', body: 'body',
      urgency: 'HIGH', timestamp: new Date(),
    };
    await bus.send(alert);

    expect(ch1.send).toHaveBeenCalledWith(alert);
    expect(ch2.send).toHaveBeenCalledWith(alert);
  });

  test('continues even if one channel fails', async () => {
    const failChannel: INotificationChannel = { send: jest.fn().mockRejectedValue(new Error('network error')) };
    const goodChannel: INotificationChannel = { send: jest.fn().mockResolvedValue(undefined) };

    const bus = new NotificationBus();
    bus.register(failChannel);
    bus.register(goodChannel);

    const alert: CopilotAlert = { type: 'SYSTEM_STATUS', title: 'T', body: 'B', urgency: 'LOW', timestamp: new Date() };
    await expect(bus.send(alert)).resolves.not.toThrow();
    expect(goodChannel.send).toHaveBeenCalled();
  });
});

// ─── 7. QueryHandler ────────────────────────────────────────────────────────
describe('QueryHandler', () => {
  let handler: QueryHandler;

  beforeEach(() => {
    handler = new QueryHandler(mockDataSource(), new WatchlistManager());
  });

  test('routes "why was NIFTY rejected" correctly', async () => {
    const resp = await handler.handle('Why was NIFTY rejected?');
    expect(resp).toContain('Portfolio heat');
  });

  test('routes "what is my drawdown" correctly', async () => {
    const resp = await handler.handle('What is my drawdown?');
    expect(resp).toContain('4.00%');
  });

  test('routes "show open positions" correctly', async () => {
    const resp = await handler.handle('Show open positions');
    expect(resp).toContain('BANKNIFTY');
  });

  test('routes "today summary" correctly', async () => {
    const resp = await handler.handle("today's summary");
    expect(resp).toContain('STRONG_BULL');
  });

  test('routes "what is my win rate" correctly', async () => {
    const resp = await handler.handle('What is my win rate?');
    expect(resp).toContain('70%');
  });

  test('routes "market regime" correctly', async () => {
    const resp = await handler.handle('What is the market regime?');
    expect(resp).toContain('STRONG_BULL');
  });

  test('routes "watch RELIANCE" correctly', async () => {
    const resp = await handler.handle('Watch RELIANCE expecting breakout soon');
    expect(resp).toContain('RELIANCE');
    expect(resp).toContain('watching');
  });

  test('routes "unwatch RELIANCE" correctly', async () => {
    const wl = new WatchlistManager();
    wl.watch('RELIANCE');
    const h = new QueryHandler(mockDataSource(), wl);
    const resp = await h.handle('unwatch RELIANCE');
    expect(resp).toContain('Removed RELIANCE');
  });

  test('unknown query returns help message', async () => {
    const resp = await handler.handle('What is the meaning of life?');
    expect(resp).toContain("didn't quite understand");
  });
});

// ─── 8. ConversationContext ──────────────────────────────────────────────────
describe('ConversationContext', () => {
  test('maintains conversation history', async () => {
    const ctx = new ConversationContext(mockDataSource(), new WatchlistManager());
    await ctx.ask('What is the market regime?');
    const history = ctx.getHistory();
    expect(history).toHaveLength(2); // user + copilot
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('copilot');
  });

  test('formatHistory returns readable transcript', async () => {
    const ctx = new ConversationContext(mockDataSource(), new WatchlistManager());
    await ctx.ask('Show open positions');
    const transcript = ctx.formatHistory();
    expect(transcript).toContain('👤 You');
    expect(transcript).toContain('🤖 Artha');
  });
});
