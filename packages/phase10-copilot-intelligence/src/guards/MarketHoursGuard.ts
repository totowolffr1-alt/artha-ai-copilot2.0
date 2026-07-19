/**
 * packages/phase10-copilot-intelligence/src/guards/MarketHoursGuard.ts
 * Artha AI — Phase 10 Market Hours Guard
 *
 * NSE market hours: 09:15 – 15:30 IST (Mon–Fri)
 * Copilot scans are suppressed outside these windows.
 */

export interface MarketHoursConfig {
  openHour:   number;   // default 9
  openMinute: number;   // default 15
  closeHour:  number;   // default 15
  closeMinute: number;  // default 25  (5min buffer before close)
  timezone:   string;   // default 'Asia/Kolkata'
}

const DEFAULT_CONFIG: MarketHoursConfig = {
  openHour:    9,
  openMinute:  15,
  closeHour:   15,
  closeMinute: 25,
  timezone:    'Asia/Kolkata',
};

export class MarketHoursGuard {
  constructor(private readonly config: MarketHoursConfig = DEFAULT_CONFIG) {}

  /**
   * Returns true if the current time is within NSE market hours on a weekday.
   */
  isMarketOpen(now: Date = new Date()): boolean {
    // Get IST time components
    const istString = now.toLocaleString('en-IN', { timeZone: this.config.timezone });
    const istDate   = new Date(istString);

    const day     = istDate.getDay(); // 0=Sun, 6=Sat
    const hour    = istDate.getHours();
    const minute  = istDate.getMinutes();
    const minutes = hour * 60 + minute;

    const openMinutes  = this.config.openHour  * 60 + this.config.openMinute;
    const closeMinutes = this.config.closeHour * 60 + this.config.closeMinute;

    // Weekday check (Mon–Fri)
    if (day === 0 || day === 6) return false;

    return minutes >= openMinutes && minutes <= closeMinutes;
  }

  /**
   * Returns the next market open time string (for logging).
   */
  nextOpenDescription(): string {
    return `Next scan at ${this.config.openHour}:${String(this.config.openMinute).padStart(2,'0')} IST on next trading day.`;
  }
}
