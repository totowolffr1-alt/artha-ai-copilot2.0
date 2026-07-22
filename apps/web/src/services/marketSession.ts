/**
 * marketSession.ts
 * Pure IST-based market session calculator — no API call needed.
 * Indian market: 09:15–15:30 IST, Monday–Friday.
 */

export type SessionStatus = 'OPEN' | 'PRE_OPEN' | 'CLOSED' | 'WEEKEND';

export interface MarketSession {
  status: SessionStatus;
  isOpen: boolean;
  isPreOpen: boolean;
  message: string;
  nextOpen: Date;
  countdown: number; // seconds to next open (0 when open)
  closesIn: number;  // seconds to close (0 when closed)
  lastUpdated: Date;
}

function getISTDate(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

export function getMarketSession(): MarketSession {
  const now = new Date();
  const ist = getISTDate();
  const day = ist.getDay();
  const h = ist.getHours();
  const m = ist.getMinutes();
  const mins = h * 60 + m;

  const isWeekend = day === 0 || day === 6;
  const isPreOpen = !isWeekend && mins >= 540 && mins < 555;  // 09:00–09:15
  const isOpen = !isWeekend && mins >= 555 && mins < 930;     // 09:15–15:30

  // Next open
  const nextOpen = new Date(ist);
  if (isOpen || isPreOpen) {
    // Already open — next open is tomorrow (or Monday)
    nextOpen.setDate(ist.getDate() + (day === 5 ? 3 : day === 6 ? 2 : 1));
  } else if (day === 6) {
    nextOpen.setDate(ist.getDate() + 2);
  } else if (day === 0) {
    nextOpen.setDate(ist.getDate() + 1);
  } else if (mins >= 930) {
    nextOpen.setDate(ist.getDate() + (day === 5 ? 3 : 1));
  }
  nextOpen.setHours(9, 15, 0, 0);

  const countdown = Math.max(0, Math.floor((nextOpen.getTime() - now.getTime()) / 1000));

  // Closes at 15:30
  const closeIST = new Date(ist);
  closeIST.setHours(15, 30, 0, 0);
  const closesIn = isOpen ? Math.max(0, Math.floor((closeIST.getTime() - now.getTime()) / 1000)) : 0;

  let status: SessionStatus = 'CLOSED';
  let message = 'Market CLOSED — Prices frozen at last close';
  if (isWeekend) { status = 'WEEKEND'; message = 'Weekend — Market opens Monday 09:15 IST'; }
  else if (isOpen) { status = 'OPEN'; message = 'Market OPEN — Live prices streaming'; }
  else if (isPreOpen) { status = 'PRE_OPEN'; message = 'Pre-Open session (09:00–09:15 IST)'; }

  return { status, isOpen, isPreOpen, message, nextOpen, countdown, closesIn, lastUpdated: now };
}

/** Format seconds as HH:MM:SS */
export function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
