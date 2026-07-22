import { notifications } from '../db/sqlite';
import { sendPushToAll } from './pushService';

export interface NotificationPayload {
  component: string;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  title: string;
  message: string;
  cause?: string;
  suggested_fix?: string;
}

const severityEmoji = {
  INFO: '🟢',
  WARNING: '🟡',
  HIGH: '🟠',
  CRITICAL: '🔴',
};

const recentNotifications = new Map<string, number>();

function isSmartSilenceActive(): boolean {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const totalMinutes = utcHours * 60 + utcMinutes + 5 * 60 + 30; // IST total minutes
  
  const istHours = Math.floor(totalMinutes / 60) % 24;
  const istMinutes = totalMinutes % 60;
  
  if (istHours >= 23 || istHours < 8 || (istHours === 8 && istMinutes < 45)) {
    return true;
  }
  return false;
}

export async function pushNotification(n: NotificationPayload) {
  const { component, severity, title, message, cause, suggested_fix } = n;
  
  // Deduplication
  const dedupKey = `${component}:${title}`;
  const now = Date.now();
  const lastTime = recentNotifications.get(dedupKey);
  if (lastTime && now - lastTime < 30 * 60 * 1000) {
    return;
  }
  recentNotifications.set(dedupKey, now);

  // Insert to DB
  notifications.insert({
    timestamp: new Date().toISOString(),
    component,
    severity,
    title,
    message,
    cause,
    suggested_fix
  });

  const emoji = severityEmoji[severity] || '🟢';
  let colorPrefix = '';
  switch (severity) {
    case 'INFO': colorPrefix = '\x1b[32m'; break;
    case 'WARNING': colorPrefix = '\x1b[33m'; break;
    case 'HIGH': colorPrefix = '\x1b[35m'; break;
    case 'CRITICAL': colorPrefix = '\x1b[31m'; break;
  }
  console.log(`${colorPrefix}[${emoji} ${severity}] ${title}: ${message}\x1b[0m`);

  const silence = isSmartSilenceActive();
  if (severity === 'HIGH' || severity === 'CRITICAL') {
    if (silence && severity !== 'CRITICAL') {
      // silenced
    } else {
      await sendPushToAll(title, message, severity);
    }
  }
}

export function getNotifications(limit: number = 50) {
  return notifications.getAll(limit);
}

export function getUnreadCount() {
  return notifications.getUnreadCount();
}

export function markRead(ids: number[]) {
  notifications.markRead(ids);
}

export function markAllRead() {
  notifications.markAllRead();
}
