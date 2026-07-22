/**
 * sqlite.ts — Persistent storage for Artha AI Phase 11
 * Uses sql.js (pure JavaScript SQLite — no native compilation needed)
 * Persists to disk via JSON file: apps/api/data/artha_db.json
 *
 * Tables: notifications, price_alerts, health_history, system_timeline,
 *         recovery_events, trade_journal, push_subscriptions
 */

import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE  = path.join(DATA_DIR, 'artha_db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── In-memory stores with disk persistence ─────────────────────────────────────
interface Notification {
  id: number;
  timestamp: string;
  component: string;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  title: string;
  message: string;
  cause?: string;
  suggested_fix?: string;
  read: boolean;
}

interface PriceAlert {
  id: number;
  symbol: string;
  condition: 'ABOVE' | 'BELOW';
  target_price: number;
  active: boolean;
  triggered: boolean;
  triggered_at?: string;
  created_at: string;
}

interface HealthRecord {
  id: number;
  service: string;
  score: number;
  status: string;
  recorded_at: string;
}

interface TimelineEvent {
  id: number;
  component: string;
  event: string;
  severity: string;
  details?: string;
  recorded_at: string;
}

interface RecoveryEvent {
  id: number;
  service: string;
  action: string;
  result: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  details?: string;
  recorded_at: string;
}

interface PushSubscription {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export interface TradeJournalRecord {
  id: number;
  trade_id: string;
  symbol: string;
  segment: 'INTRADAY' | 'DELIVERY';
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price?: number;
  quantity: number;
  stop_loss: number;
  take_profit: number;
  entry_time: string;
  exit_time?: string;
  status: 'OPEN' | 'CLOSED';
  exit_reason?: 'TARGET_HIT' | 'STOP_HIT' | 'TIME_EXIT' | 'MANUAL' | 'REGIME_FLIP';
  gross_pnl?: number;
  net_pnl?: number;
  total_costs?: number;
  regime?: string;
  regime_confidence?: number;
  r_multiple?: number;
  holding_period_mins?: number;
  created_at: string;
}

interface DbState {
  notifications: Notification[];
  price_alerts: PriceAlert[];
  health_history: HealthRecord[];
  system_timeline: TimelineEvent[];
  recovery_events: RecoveryEvent[];
  push_subscriptions: PushSubscription[];
  trade_journal: TradeJournalRecord[];
  _counters: Record<string, number>;
}

let _state: DbState = {
  notifications: [],
  price_alerts: [],
  health_history: [],
  system_timeline: [],
  recovery_events: [],
  push_subscriptions: [],
  trade_journal: [],
  _counters: {},
};

// ── Load from disk ─────────────────────────────────────────────────────────────
function load(): void {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      _state = { ..._state, ...JSON.parse(raw) };
      console.log('[DB] ✅ Loaded persisted data from disk.');
    }
  } catch (err) {
    console.warn('[DB] Could not load persisted data, starting fresh:', err);
  }
}

// ── Save to disk (debounced) ───────────────────────────────────────────────────
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function save(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(_state, null, 2), 'utf8');
    } catch (err) {
      console.warn('[DB] Could not persist data:', err);
    }
  }, 500);
}

// ── Auto-purge old records ─────────────────────────────────────────────────────
function purgeOld(): void {
  const now = Date.now();
  const h24 = 24 * 60 * 60 * 1000;
  const d7  = 7  * 24 * 60 * 60 * 1000;
  const d3  = 3  * 24 * 60 * 60 * 1000;

  const before24h = new Date(now - h24).toISOString();
  const before7d  = new Date(now - d7).toISOString();
  const before3d  = new Date(now - d3).toISOString();

  _state.health_history   = _state.health_history.filter(r => r.recorded_at >= before24h);
  _state.system_timeline  = _state.system_timeline.filter(r => r.recorded_at >= before7d);
  _state.notifications    = _state.notifications.filter(
    r => !r.read || r.timestamp >= before3d
  );

  // Keep max 500 timeline events and 100 notifications
  if (_state.system_timeline.length > 500) _state.system_timeline = _state.system_timeline.slice(-500);
  if (_state.notifications.length   > 100) _state.notifications   = _state.notifications.slice(-100);

  save();
}

// ── ID generator ──────────────────────────────────────────────────────────────
function nextId(table: string): number {
  _state._counters[table] = (_state._counters[table] || 0) + 1;
  return _state._counters[table];
}

// ── Notification CRUD ─────────────────────────────────────────────────────────
export const notifications = {
  insert(n: Omit<Notification, 'id' | 'read'>): Notification {
    const rec: Notification = { id: nextId('notifications'), read: false, ...n };
    _state.notifications.unshift(rec);
    if (_state.notifications.length > 100) _state.notifications.pop();
    save();
    return rec;
  },
  getAll(limit = 50): Notification[] {
    return _state.notifications.slice(0, limit);
  },
  getUnreadCount(): number {
    return _state.notifications.filter(n => !n.read).length;
  },
  markRead(ids: number[]): void {
    _state.notifications.forEach(n => { if (ids.includes(n.id)) n.read = true; });
    save();
  },
  markAllRead(): void {
    _state.notifications.forEach(n => { n.read = true; });
    save();
  },
};

// ── Price Alert CRUD ───────────────────────────────────────────────────────────
export const priceAlerts = {
  insert(a: Omit<PriceAlert, 'id' | 'triggered' | 'created_at'>): PriceAlert {
    const rec: PriceAlert = {
      id: nextId('price_alerts'), triggered: false,
      created_at: new Date().toISOString(), ...a,
    };
    _state.price_alerts.push(rec);
    save();
    return rec;
  },
  getActive(): PriceAlert[] {
    return _state.price_alerts.filter(a => a.active && !a.triggered);
  },
  getAll(): PriceAlert[] {
    return _state.price_alerts;
  },
  trigger(id: number): void {
    const a = _state.price_alerts.find(x => x.id === id);
    if (a) { a.triggered = true; a.triggered_at = new Date().toISOString(); save(); }
  },
  delete(id: number): void {
    _state.price_alerts = _state.price_alerts.filter(a => a.id !== id);
    save();
  },
};

// ── Health History CRUD ────────────────────────────────────────────────────────
export const healthHistory = {
  insert(service: string, score: number, status: string): void {
    _state.health_history.push({
      id: nextId('health_history'), service, score, status,
      recorded_at: new Date().toISOString(),
    });
    save();
  },
  getForService(service: string, hours = 24): HealthRecord[] {
    const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
    return _state.health_history.filter(r => r.service === service && r.recorded_at >= cutoff);
  },
};

// ── System Timeline CRUD ───────────────────────────────────────────────────────
export const systemTimeline = {
  insert(component: string, event: string, severity: string, details?: string): TimelineEvent {
    const rec: TimelineEvent = {
      id: nextId('system_timeline'), component, event, severity, details,
      recorded_at: new Date().toISOString(),
    };
    _state.system_timeline.unshift(rec);
    if (_state.system_timeline.length > 500) _state.system_timeline.pop();
    save();
    return rec;
  },
  getRecent(limit = 100): TimelineEvent[] {
    return _state.system_timeline.slice(0, limit);
  },
};

// ── Recovery Events CRUD ───────────────────────────────────────────────────────
export const recoveryEvents = {
  insert(service: string, action: string, result: 'SUCCESS' | 'FAILED' | 'SKIPPED', details?: string): void {
    _state.recovery_events.unshift({
      id: nextId('recovery_events'), service, action, result, details,
      recorded_at: new Date().toISOString(),
    });
    if (_state.recovery_events.length > 200) _state.recovery_events.pop();
    save();
  },
  getRecent(limit = 50): RecoveryEvent[] {
    return _state.recovery_events.slice(0, limit);
  },
};

// ── Trade Journal CRUD ────────────────────────────────────────────────────────
export const tradeJournal = {
  insert(t: Omit<TradeJournalRecord, 'id' | 'created_at'>): TradeJournalRecord {
    const rec: TradeJournalRecord = {
      id: nextId('trade_journal'),
      created_at: new Date().toISOString(),
      ...t,
    };
    _state.trade_journal.unshift(rec);
    save();
    return rec;
  },
  update(tradeId: string, updates: Partial<TradeJournalRecord>): TradeJournalRecord | null {
    const entry = _state.trade_journal.find(x => x.trade_id === tradeId);
    if (!entry) return null;
    Object.assign(entry, updates);
    save();
    return entry;
  },
  getAll(limit = 100): TradeJournalRecord[] {
    return _state.trade_journal.slice(0, limit);
  },
  getOpen(): TradeJournalRecord[] {
    return _state.trade_journal.filter(t => t.status === 'OPEN');
  },
  getClosed(limit = 100): TradeJournalRecord[] {
    return _state.trade_journal.filter(t => t.status === 'CLOSED').slice(0, limit);
  },
  getBySymbol(symbol: string): TradeJournalRecord[] {
    return _state.trade_journal.filter(t => t.symbol === symbol);
  },
  clearAll(): void {
    _state.trade_journal = [];
    save();
  },
};

// ── Push Subscriptions CRUD ────────────────────────────────────────────────────
export const pushSubscriptions = {
  upsert(endpoint: string, p256dh: string, auth: string): void {
    const existing = _state.push_subscriptions.find(s => s.endpoint === endpoint);
    if (existing) { existing.p256dh = p256dh; existing.auth = auth; }
    else {
      _state.push_subscriptions.push({
        id: nextId('push_subscriptions'), endpoint, p256dh, auth,
        created_at: new Date().toISOString(),
      });
    }
    save();
  },
  getAll(): PushSubscription[] {
    return _state.push_subscriptions;
  },
  remove(endpoint: string): void {
    _state.push_subscriptions = _state.push_subscriptions.filter(s => s.endpoint !== endpoint);
    save();
  },
};

// ── Initialize ─────────────────────────────────────────────────────────────────
load();
purgeOld();

// Run purge every hour
setInterval(purgeOld, 60 * 60 * 1000);

console.log(`[DB] ✅ Artha database ready. File: ${DB_FILE}`);
