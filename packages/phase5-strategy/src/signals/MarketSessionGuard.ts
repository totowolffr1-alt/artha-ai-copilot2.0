/**
 * packages/phase5-strategy/src/signals/MarketSessionGuard.ts
 * Artha AI — NSE Market Session Time-Gate
 *
 * Enforces strict NSE market session rules in IST (UTC+5:30):
 *  - Market hours: 09:15 – 15:30, Monday–Friday
 *  - Pre-open session blocked (09:00–09:15): High volatility, no entries
 *  - Last 15 min blocked for new entries (15:15–15:30): Mandatory square-off window
 *  - National holidays: hard-coded annual holiday list for NSE 2025
 *
 * Usage: call `MarketSessionGuard.canTrade()` before emitting any signal.
 */

export type SessionStatus =
  | 'OPEN'              // 09:30 – 15:15 — safe to trade
  | 'PRE_OPEN'          // 09:00 – 09:15 — wild opening auction
  | 'OPENING_VOLATILITY'// 09:15 – 09:30 — first candle chaos
  | 'CLOSING_WINDOW'    // 15:15 – 15:30 — intraday square-off mandatory
  | 'CLOSED'            // Outside market hours
  | 'HOLIDAY'           // National / NSE holiday
  | 'WEEKEND';          // Saturday or Sunday

export interface SessionInfo {
  status: SessionStatus;
  canTrade: boolean;
  reason: string;
  istTimeStr: string;   // Human-readable IST time for logging
}

// NSE Trading Holidays 2025 (YYYY-MM-DD in IST)
// Source: NSE official holiday list
const NSE_HOLIDAYS_2025: Set<string> = new Set([
  '2025-01-26', // Republic Day
  '2025-02-26', // Mahashivratri
  '2025-03-14', // Holi
  '2025-03-31', // Id-Ul-Fitr (Ramzan Eid)
  '2025-04-10', // Dr. Ambedkar Jayanti
  '2025-04-14', // Ram Navami
  '2025-04-18', // Good Friday
  '2025-05-01', // Maharashtra Day
  '2025-08-15', // Independence Day
  '2025-08-27', // Ganesh Chaturthi
  '2025-10-02', // Gandhi Jayanti (Mahatma Gandhi Jayanti)
  '2025-10-02', // Dussehra
  '2025-10-21', // Diwali Laxmi Puja (Muhurat Trading — special session)
  '2025-10-22', // Diwali Balipratipada
  '2025-11-05', // Guru Nanak Jayanti
  '2025-12-25', // Christmas
]);

// NSE Trading Holidays 2026 (partial — extend as confirmed by NSE)
const NSE_HOLIDAYS_2026: Set<string> = new Set([
  '2026-01-26', // Republic Day
  '2026-03-03', // Holi (tentative)
  '2026-04-03', // Good Friday (tentative)
  '2026-04-14', // Dr. Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-08-15', // Independence Day
  '2026-10-02', // Gandhi Jayanti
  '2026-12-25', // Christmas
]);

const ALL_HOLIDAYS = new Set([...NSE_HOLIDAYS_2025, ...NSE_HOLIDAYS_2026]);

export class MarketSessionGuard {
  /**
   * Returns the current IST-based session status.
   * Pass an optional `now` (UTC ms) for backtesting or unit tests.
   */
  static getSessionInfo(now?: number): SessionInfo {
    const utcMs = now ?? Date.now();
    const utcDate = new Date(utcMs);

    // Convert to IST (UTC+5:30)
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istMs = utcMs + istOffsetMs;
    const ist = new Date(istMs);

    const dayOfWeek   = ist.getUTCDay();    // 0=Sun, 6=Sat
    const hourIST     = ist.getUTCHours();
    const minuteIST   = ist.getUTCMinutes();
    const totalMins   = hourIST * 60 + minuteIST;

    const istTimeStr = `${String(hourIST).padStart(2,'0')}:${String(minuteIST).padStart(2,'0')} IST`;

    // Date string in YYYY-MM-DD for holiday lookup (IST date)
    const istDateStr = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth()+1).padStart(2,'0')}-${String(ist.getUTCDate()).padStart(2,'0')}`;

    // Weekend check
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        status: 'WEEKEND',
        canTrade: false,
        reason: `Weekend — NSE closed`,
        istTimeStr,
      };
    }

    // Holiday check
    if (ALL_HOLIDAYS.has(istDateStr)) {
      return {
        status: 'HOLIDAY',
        canTrade: false,
        reason: `NSE Holiday on ${istDateStr}`,
        istTimeStr,
      };
    }

    // Time window checks (all in minutes from midnight IST)
    const PRE_OPEN_START   =  9 * 60;       // 09:00
    const MARKET_OPEN      =  9 * 60 + 15;  // 09:15
    const SAFE_ENTRY_START =  9 * 60 + 30;  // 09:30 — first 15 min volatility clears
    const SAFE_ENTRY_END   = 15 * 60 + 15;  // 15:15 — close out window starts
    const MARKET_CLOSE     = 15 * 60 + 30;  // 15:30

    if (totalMins < PRE_OPEN_START || totalMins >= MARKET_CLOSE) {
      return {
        status: 'CLOSED',
        canTrade: false,
        reason: `Market closed — NSE hours are 09:15–15:30 IST`,
        istTimeStr,
      };
    }

    if (totalMins >= PRE_OPEN_START && totalMins < MARKET_OPEN) {
      return {
        status: 'PRE_OPEN',
        canTrade: false,
        reason: `Pre-open auction session (09:00–09:15). No entries allowed.`,
        istTimeStr,
      };
    }

    if (totalMins >= MARKET_OPEN && totalMins < SAFE_ENTRY_START) {
      return {
        status: 'OPENING_VOLATILITY',
        canTrade: false,
        reason: `Opening volatility window (09:15–09:30). First 15 min blocked for safety.`,
        istTimeStr,
      };
    }

    if (totalMins >= SAFE_ENTRY_END && totalMins < MARKET_CLOSE) {
      return {
        status: 'CLOSING_WINDOW',
        canTrade: false,
        reason: `Intraday closing window (15:15–15:30). No new entries — square off only.`,
        istTimeStr,
      };
    }

    // 09:30 – 15:15 → safe to trade
    return {
      status: 'OPEN',
      canTrade: true,
      reason: `Market open and in safe trading window`,
      istTimeStr,
    };
  }

  /** Simple boolean check — the most common use case */
  static canTrade(now?: number): boolean {
    return MarketSessionGuard.getSessionInfo(now).canTrade;
  }

  /** Check if currently in closing window (for forcing square-off) */
  static isClosingWindow(now?: number): boolean {
    return MarketSessionGuard.getSessionInfo(now).status === 'CLOSING_WINDOW';
  }

  /** Remaining minutes in the safe trading window */
  static minutesUntilClose(now?: number): number {
    const utcMs = now ?? Date.now();
    const istMs = utcMs + 5.5 * 60 * 60 * 1000;
    const ist = new Date(istMs);
    const hourIST   = ist.getUTCHours();
    const minuteIST = ist.getUTCMinutes();
    const totalMins = hourIST * 60 + minuteIST;
    const safeClose = 15 * 60 + 15; // 15:15
    return Math.max(0, safeClose - totalMins);
  }
}
