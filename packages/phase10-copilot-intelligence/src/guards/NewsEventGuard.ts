/**
 * packages/phase10-copilot-intelligence/src/guards/NewsEventGuard.ts
 * Artha AI — Phase 10 News Event Guard
 *
 * Suppresses signals during high-impact corporate announcements or earnings calendars.
 * Prevents buying/selling right before unpredictable news spikes (e.g. quarterly earnings).
 */

import { QueryHandler } from '../conversation/QueryHandler';

export type CorporateEventType =
  | 'EARNINGS'
  | 'DIVIDEND'
  | 'AGM'
  | 'BOARD_MEETING'
  | 'STOCK_SPLIT'
  | 'RIGHTS_ISSUE'
  | 'SEBI_NOTICE'
  | 'MERGER'
  | 'DELISTING'
  | 'OTHER';

export interface CorporateEvent {
  symbol:         string;
  event_type:     CorporateEventType;
  event_date:     Date;
  description:    string;
  blackout_hours: number;
}

export class NewsEventGuard {
  constructor(
    /** Callback to query upcoming events for a symbol from DB */
    private readonly fetchEvents: (symbol: string) => Promise<CorporateEvent[]>
  ) {}

  /**
   * Check if a symbol is currently inside a corporate event blackout window.
   * Typically 48 hours leading up to the event date.
   */
  async checkBlackout(symbol: string, now: Date = new Date()): Promise<{ passed: boolean; reason?: string; event?: CorporateEvent }> {
    const events = await this.fetchEvents(symbol);

    for (const event of events) {
      const eventTime = event.event_date.getTime();
      const nowTime   = now.getTime();

      // Enforce blackout hours before the event date
      // Swing trading mode requires 72 hours (3 days) buffer before earnings
      const mode = process.env.TRADING_MODE || 'INTRADAY';
      let hours = event.blackout_hours;
      if (mode === 'SWING' && event.event_type === 'EARNINGS') {
        hours = Math.max(hours, 72);
      } else if (mode === 'INTRADAY') {
        hours = Math.max(hours, 24);
      }
      
      const blackoutMs = hours * 60 * 60 * 1000;
      
      // If we are within the blackout period before the event date, block it!
      if (nowTime < eventTime && eventTime - nowTime <= blackoutMs) {
        return {
          passed: false,
          reason: `PRE_EVENT_BLACKOUT: ${event.event_type} event on ${event.event_date.toISOString().split('T')[0]}`,
          event,
        };
      }

      // Also block if it is the event day itself (to avoid post-news volatility before daily close)
      const eventDay = new Date(event.event_date).setHours(0,0,0,0);
      const today    = new Date(now).setHours(0,0,0,0);
      if (eventDay === today) {
        return {
          passed: false,
          reason: `EVENT_DAY_BLACKOUT: Active event ${event.event_type} today`,
          event,
        };
      }
    }

    return { passed: true };
  }
}
