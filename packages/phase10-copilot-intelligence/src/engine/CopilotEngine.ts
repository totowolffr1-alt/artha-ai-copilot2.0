/**
 * packages/phase10-copilot-intelligence/src/engine/CopilotEngine.ts
 * Artha AI — Phase 10 Main Copilot Engine
 *
 * The core orchestrator. Runs a polling loop during market hours,
 * scores opportunities from all backend engines, and fires proactive alerts.
 * Also monitors live positions for stop-hit events.
 */

import { OpportunityScorer } from './OpportunityScorer';
import { MarketHoursGuard } from '../guards/MarketHoursGuard';
import { AlertCooldownGuard } from '../guards/AlertCooldownGuard';
import { WatchlistManager } from '../watchlist/WatchlistManager';
import { NotificationBus } from '../notifications/NotificationBus';
import {
  RawOpportunity,
  ScoredOpportunity,
  LivePosition,
  CopilotAlert,
} from '../types';

export interface CopilotEngineConfig {
  /** Polling interval in milliseconds. Default: 5 minutes */
  pollIntervalMs:         number;
  /** Global minimum copilot score to alert (0–100). Default: 65 */
  globalScoreThreshold:   number;
  /** Enable stop-hit monitoring. Default: true */
  monitorStopHits:        boolean;
}

const DEFAULT_CONFIG: CopilotEngineConfig = {
  pollIntervalMs:       5 * 60 * 1000,  // 5 minutes
  globalScoreThreshold: 65,
  monitorStopHits:      true,
};

export class CopilotEngine {
  private pollTimer:   ReturnType<typeof setInterval> | null = null;
  private isRunning:   boolean = false;

  private readonly scorer:      OpportunityScorer;
  private readonly hoursGuard:  MarketHoursGuard;
  private readonly cooldown:    AlertCooldownGuard;

  constructor(
    private readonly bus:              NotificationBus,
    private readonly watchlist:        WatchlistManager,
    private readonly fetchOpportunities: () => Promise<RawOpportunity[]>,
    private readonly fetchLivePositions: () => Promise<LivePosition[]>,
    private readonly config:           CopilotEngineConfig = DEFAULT_CONFIG
  ) {
    this.scorer     = new OpportunityScorer();
    this.hoursGuard = new MarketHoursGuard();
    this.cooldown   = new AlertCooldownGuard(30 * 60 * 1000); // 30-min cooldown
  }

  /** Start the copilot polling loop. */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Clear cooldowns at session start
    this.cooldown.clearAll();

    console.log(`\n🤖 Artha Copilot started. Scanning every ${this.config.pollIntervalMs / 60000} minutes.\n`);

    // Immediate first scan
    void this._scan();

    this.pollTimer = setInterval(() => {
      void this._scan();
    }, this.config.pollIntervalMs);
  }

  /** Stop the copilot polling loop. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isRunning = false;
    console.log('🤖 Artha Copilot stopped.');
  }

  /** Run a single scan cycle. */
  async scan(): Promise<ScoredOpportunity[]> {
    return this._scan();
  }

  private async _scan(): Promise<ScoredOpportunity[]> {
    // ── Market hours check ────────────────────────────────────
    if (!this.hoursGuard.isMarketOpen()) {
      console.log(`🤖 Market closed. ${this.hoursGuard.nextOpenDescription()}`);
      return [];
    }

    const results: ScoredOpportunity[] = [];

    try {
      // ── Score opportunities ───────────────────────────────────
      const raw = await this.fetchOpportunities();
      for (const opp of raw) {
        const scored = this.scorer.score(opp);

        // Determine effective threshold (lower for watchlisted symbols)
        const threshold = this.watchlist.getThreshold(
          opp.symbol,
          this.config.globalScoreThreshold
        );

        if (scored.copilot_score < threshold) continue;
        if (!scored.should_notify) continue;
        if (!this.cooldown.canAlert(opp.symbol)) continue;

        // Fire opportunity alert!
        await this.bus.send(this._buildOpportunityAlert(scored));
        this.cooldown.markAlerted(opp.symbol);
        results.push(scored);
      }

      // ── Stop-hit monitoring ───────────────────────────────────
      if (this.config.monitorStopHits) {
        const positions = await this.fetchLivePositions();
        for (const pos of positions) {
          if (this._isStopHit(pos)) {
            await this.bus.send(this._buildStopHitAlert(pos));
          }
        }
      }

      // ── Kill switch alert ─────────────────────────────────────
      const killSwitchActive = raw.some(o => o.kill_switch_active);
      if (killSwitchActive && this.cooldown.canAlert('__KILLSWITCH__')) {
        await this.bus.send({
          type: 'KILL_SWITCH',
          title: '🔴 EMERGENCY STOP ACTIVE',
          body: 'Artha KillSwitch is active. All new order submissions are blocked.\nCheck unexpected_fills log for details.',
          urgency: 'CRITICAL',
          timestamp: new Date(),
        });
        this.cooldown.markAlerted('__KILLSWITCH__');
      }

    } catch (err: any) {
      console.error(`[CopilotEngine] Scan error: ${err.message}`);
    }

    return results;
  }

  private _isStopHit(pos: LivePosition): boolean {
    if (pos.direction === 'LONG')  return pos.ltp <= pos.stop_price;
    if (pos.direction === 'SHORT') return pos.ltp >= pos.stop_price;
    return false;
  }

  private _buildOpportunityAlert(scored: ScoredOpportunity): CopilotAlert {
    const divider = '─'.repeat(45);
    const body = [
      divider,
      ...scored.detail_lines,
      '',
      'Action    : Ready to review in dashboard.',
      divider,
    ].join('\n');

    return {
      type:      'OPPORTUNITY',
      title:     `🚀 Artha Copilot — ${scored.symbol} ${scored.direction} Setup`,
      body,
      symbol:    scored.symbol,
      urgency:   scored.confidence_band === 'HIGH' ? 'HIGH' : 'MEDIUM',
      timestamp: new Date(),
    };
  }

  private _buildStopHitAlert(pos: LivePosition): CopilotAlert {
    const pnl     = pos.unrealised_pnl;
    const pnlSign = pnl >= 0 ? '+' : '';

    return {
      type:    'STOP_HIT',
      title:   `⚠️ Stop Hit — ${pos.symbol}`,
      body:    [
        `─────────────────────────────────────────────`,
        `Symbol    : ${pos.symbol}`,
        `Direction : ${pos.direction}`,
        `Entry     : ₹${pos.entry_price.toFixed(2)}`,
        `Stop Hit  : ₹${pos.stop_price.toFixed(2)}`,
        `LTP       : ₹${pos.ltp.toFixed(2)}`,
        `Qty       : ${pos.qty}`,
        `P&L       : ${pnlSign}₹${pnl.toFixed(2)}`,
        `─────────────────────────────────────────────`,
        `Position approaching stop. Review immediately.`,
      ].join('\n'),
      symbol:  pos.symbol,
      urgency: 'HIGH',
      timestamp: new Date(),
    };
  }
}
