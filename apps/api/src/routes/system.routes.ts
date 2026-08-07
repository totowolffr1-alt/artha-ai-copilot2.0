/**
 * system.routes.ts — Phase 11 Backend Health & Monitoring API
 *
 * GET  /api/system/health           - Overall health + all service statuses
 * GET  /api/system/status           - Live service statuses only
 * GET  /api/system/metrics          - Response times, uptime, error counts
 * GET  /api/system/notifications    - Recent notifications (last 50)
 * GET  /api/system/timeline         - System event timeline
 * GET  /api/system/diagnostics      - Full AI-readable diagnostic report
 * GET  /api/system/logs             - Recent log entries
 * POST /api/system/restart-service  - Trigger self-healing
 * POST /api/system/notifications/read - Mark notification(s) as read
 * GET  /api/system/push/vapid-key   - Get VAPID public key for push
 * POST /api/system/push/subscribe   - Register browser push subscription
 * DELETE /api/system/push/unsubscribe - Remove push subscription
 * POST /api/system/run-diagnostic   - Force immediate health check
 * GET  /api/system/price-alerts     - Get all custom price alerts
 * POST /api/system/price-alerts     - Create a new price alert
 * DELETE /api/system/price-alerts/:id - Delete a price alert
 */

import { Router, Request, Response } from 'express';
import { getSystemHealth, getServiceHealth, runImmediateCheck } from '../services/healthMonitor';
import { getNotifications, getUnreadCount, markRead, markAllRead } from '../services/notificationService';
import { getTimeline } from '../services/systemTimeline';
import { getRecoveryLog, triggerRecovery, RecoveryAction } from '../services/recoveryService';
import { getVapidPublicKey, addSubscription, removeSubscription } from '../services/pushService';
import { priceAlerts, notifications as notifStore } from '../db/sqlite';

export const systemRouter = Router();

// ── GET /api/system/health ─────────────────────────────────────────────────────
systemRouter.get('/health', (_req: Request, res: Response) => {
  const health = getSystemHealth();
  res.json({
    overall: health.overall,
    status: health.overall >= 90 ? 'HEALTHY' : health.overall >= 70 ? 'WARNING' : health.overall >= 50 ? 'DEGRADED' : 'CRITICAL',
    services: health.services,
    lastCheck: health.lastCheck,
    unreadNotifications: getUnreadCount(),
  });
});

// ── GET /api/system/status ─────────────────────────────────────────────────────
systemRouter.get('/status', (_req: Request, res: Response) => {
  const health = getSystemHealth();
  const statuses: Record<string, { status: string; score: number; message: string }> = {};
  Object.entries(health.services).forEach(([name, svc]) => {
    statuses[name] = { status: svc.status, score: svc.score, message: svc.message };
  });
  res.json({ overall: health.overall, services: statuses, lastCheck: health.lastCheck });
});

// ── GET /api/system/metrics ────────────────────────────────────────────────────
systemRouter.get('/metrics', (_req: Request, res: Response) => {
  const health = getSystemHealth();
  const metrics: Record<string, { responseTimeMs: number; errorCount: number; uptime: number; score: number }> = {};
  Object.entries(health.services).forEach(([name, svc]) => {
    metrics[name] = {
      responseTimeMs: svc.responseTimeMs,
      errorCount:     svc.errorCount,
      uptime:         svc.uptime,
      score:          svc.score,
    };
  });
  res.json({ metrics, lastCheck: health.lastCheck });
});

// ── GET /api/system/notifications ─────────────────────────────────────────────
systemRouter.get('/notifications', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '50', 10);
  res.json({
    notifications: getNotifications(limit),
    unread: getUnreadCount(),
  });
});

// ── POST /api/system/notifications/read ───────────────────────────────────────
systemRouter.post('/notifications/read', (req: Request, res: Response) => {
  const { ids, all } = req.body ?? {};
  if (all) markAllRead();
  else if (Array.isArray(ids)) markRead(ids);
  res.json({ success: true });
});

// ── GET /api/system/timeline ───────────────────────────────────────────────────
systemRouter.get('/timeline', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '100', 10);
  res.json({ timeline: getTimeline(limit) });
});

// ── GET /api/system/logs ───────────────────────────────────────────────────────
systemRouter.get('/logs', (_req: Request, res: Response) => {
  // Return recent notifications as log entries (timestamped, severity-labeled)
  res.json({
    logs: notifStore.getAll(100).map(n => ({
      timestamp:  n.timestamp,
      level:      n.severity,
      component:  n.component,
      message:    n.message,
      cause:      n.cause,
    })),
  });
});

// ── GET /api/system/diagnostics ───────────────────────────────────────────────
systemRouter.get('/diagnostics', (_req: Request, res: Response) => {
  const health = getSystemHealth();
  const critical: string[] = [];
  const warnings: string[] = [];

  Object.entries(health.services).forEach(([name, svc]) => {
    if (svc.status === 'CRITICAL') critical.push(`${name}: ${svc.message}`);
    else if (svc.status === 'WARNING' || svc.status === 'DEGRADED') warnings.push(`${name}: ${svc.message}`);
  });

  const reportLines = [
    `🖥️ System Health: ${health.overall}%`,
    '─'.repeat(40),
    ...Object.entries(health.services).map(([name, svc]) => {
      const icon = svc.status === 'HEALTHY' ? '🟢' : svc.status === 'WARNING' ? '🟡' : svc.status === 'DEGRADED' ? '🟠' : '🔴';
      const label = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).padEnd(22);
      return `${icon} ${label} ${String(svc.score).padStart(3)}  ${svc.message}`;
    }),
    '─'.repeat(40),
  ];

  if (critical.length) {
    reportLines.push('🔴 Critical Issues:');
    critical.forEach(c => reportLines.push(`  • ${c}`));
  }
  if (warnings.length) {
    reportLines.push('⚠️  Warnings:');
    warnings.forEach(w => reportLines.push(`  • ${w}`));
  }
  if (!critical.length && !warnings.length) {
    reportLines.push('✅ No issues detected. All systems operational.');
  }

  const recoveryLog = getRecoveryLog(10);
  if (recoveryLog.length) {
    reportLines.push('', '🔁 Recent Recovery Actions:');
    recoveryLog.slice(0, 5).forEach(r => {
      reportLines.push(`  • ${r.recorded_at.slice(0, 16)} — ${r.service}: ${r.action} → ${r.result}`);
    });
  }

  res.json({
    overall:    health.overall,
    report:     reportLines.join('\n'),
    services:   health.services,
    critical,
    warnings,
    lastCheck:  health.lastCheck,
    recoveryLog: recoveryLog.slice(0, 10),
  });
});

// ── POST /api/system/restart-service ──────────────────────────────────────────
systemRouter.post('/restart-service', async (req: Request, res: Response) => {
  const { service, action } = req.body ?? {};
  if (!service || !action) {
    return res.status(400).json({ error: 'service and action are required' });
  }
  const validActions: RecoveryAction[] = [
    'reconnect_websocket', 'retry_broker_auth', 'restart_news_worker',
    'retry_price_cache', 'reinit_indicator_engine',
  ];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `Invalid action. Valid: ${validActions.join(', ')}` });
  }
  const success = await triggerRecovery(service, action as RecoveryAction);
  res.json({ success, service, action });
});

// ── POST /api/system/run-diagnostic ───────────────────────────────────────────
systemRouter.post('/run-diagnostic', async (_req: Request, res: Response) => {
  await runImmediateCheck();
  const health = getSystemHealth();
  res.json({ success: true, overall: health.overall, lastCheck: health.lastCheck });
});

// ── Browser Push Notification Endpoints ───────────────────────────────────────
systemRouter.get('/push/vapid-key', (_req: Request, res: Response) => {
  res.json({ publicKey: getVapidPublicKey() });
});

systemRouter.post('/push/subscribe', (req: Request, res: Response) => {
  const { endpoint, keys } = req.body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription payload' });
  }
  addSubscription(endpoint, keys.p256dh, keys.auth);
  res.json({ success: true, message: 'Push subscription registered.' });
});

systemRouter.delete('/push/unsubscribe', (req: Request, res: Response) => {
  const { endpoint } = req.body ?? {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  removeSubscription(endpoint);
  res.json({ success: true });
});

// ── Custom Price Alerts ────────────────────────────────────────────────────────
systemRouter.get('/price-alerts', (_req: Request, res: Response) => {
  res.json({ alerts: priceAlerts.getAll() });
});

systemRouter.post('/price-alerts', (req: Request, res: Response) => {
  const { symbol, condition, target_price } = req.body ?? {};
  if (!symbol || !condition || target_price === undefined) {
    return res.status(400).json({ error: 'symbol, condition (ABOVE|BELOW), and target_price are required' });
  }
  if (!['ABOVE', 'BELOW'].includes(condition)) {
    return res.status(400).json({ error: 'condition must be ABOVE or BELOW' });
  }
  const alert = priceAlerts.insert({
    symbol: symbol.toUpperCase(),
    condition,
    target_price: parseFloat(target_price),
    active: true,
  });
  res.json({ success: true, alert });
});

systemRouter.delete('/price-alerts/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  priceAlerts.delete(id);
  res.json({ success: true });
});

// ── GET /api/system/server-ip ──────────────────────────────────────────────────
systemRouter.get('/server-ip', async (_req: Request, res: Response) => {
  try {
    const axios = require('axios');
    const { data } = await axios.get('https://api.ipify.org?format=json', { timeout: 3000 });
    res.json({ ip: data?.ip || 'unknown' });
  } catch (err: any) {
    res.json({ ip: 'unknown', error: err.message });
  }
});

// ── GET /api/system/broker ─────────────────────────────────────────────────────
// Returns active broker metadata + missing env vars for UI display
systemRouter.get('/broker', (_req: Request, res: Response) => {
  const BROKER_REGISTRY: Record<string, {
    name: string; website: string; apiDocs: string;
    brokerageModel: string; supportedSegments: string[]; envVarsRequired: string[];
  }> = {
    ANGELONE: {
      name: 'Angel One (SmartAPI)', website: 'https://www.angelbroking.com',
      apiDocs: 'https://smartapi.angelbroking.com/docs',
      brokerageModel: '₹20/order for F&O, free for delivery',
      supportedSegments: ['NSE', 'BSE', 'NFO', 'MCX'],
      envVarsRequired: ['ANGELONE_CLIENT_ID', 'ANGELONE_CLIENT_SECRET', 'ANGELONE_PASSWORD', 'ANGELONE_TOTP_SECRET'],
    },
    UPSTOX: {
      name: 'Upstox (API v2)', website: 'https://upstox.com',
      apiDocs: 'https://upstox.com/developer/api-documentation',
      brokerageModel: '₹20/order or 2.5% (F&O), zero on delivery',
      supportedSegments: ['NSE', 'BSE', 'NFO', 'CDS'],
      envVarsRequired: ['UPSTOX_ACCESS_TOKEN'],
    },
    ZERODHA: {
      name: 'Zerodha (Kite Connect v3)', website: 'https://zerodha.com',
      apiDocs: 'https://kite.trade/docs/connect/v3/',
      brokerageModel: '₹20/order or 0.03% (intraday/F&O), zero delivery',
      supportedSegments: ['NSE', 'BSE', 'NFO', 'CDS', 'MCX'],
      envVarsRequired: ['ZERODHA_API_KEY', 'ZERODHA_ACCESS_TOKEN'],
    },
    FYERS: {
      name: 'Fyers (API v2)', website: 'https://fyers.in',
      apiDocs: 'https://myapi.fyers.in/docs/',
      brokerageModel: '₹20/order (F&O), zero delivery',
      supportedSegments: ['NSE', 'BSE', 'NFO', 'CDS', 'MCX'],
      envVarsRequired: ['FYERS_APP_ID', 'FYERS_ACCESS_TOKEN'],
    },
    DHAN: {
      name: 'Dhan HQ (API v2)', website: 'https://dhan.co',
      apiDocs: 'https://dhanhq.co/docs/v2/',
      brokerageModel: '₹20/order (F&O), zero on delivery',
      supportedSegments: ['NSE', 'BSE', 'NFO', 'CDS', 'MCX'],
      envVarsRequired: ['DHAN_CLIENT_ID', 'DHAN_ACCESS_TOKEN'],
    },
    SHOONYA: {
      name: 'Shoonya by Finvasia', website: 'https://shoonya.com',
      apiDocs: 'https://api.shoonya.com/',
      brokerageModel: 'ZERO brokerage on ALL segments',
      supportedSegments: ['NSE', 'BSE', 'NFO', 'CDS', 'MCX', 'NCDEX'],
      envVarsRequired: ['SHOONYA_USER_ID', 'SHOONYA_SESSION_TOKEN'],
    },
    PAPER: {
      name: 'Paper Trading (Simulated)', website: 'https://artha.ai',
      apiDocs: 'https://artha.ai/docs/paper-trading',
      brokerageModel: 'Free (no real money)',
      supportedSegments: ['NSE', 'BSE', 'NFO', 'MCX'],
      envVarsRequired: [],
    },
  };

  const rawProvider = (process.env.BROKER_PROVIDER || 'PAPER').toUpperCase();
  const provider = BROKER_REGISTRY[rawProvider] ? rawProvider : 'PAPER';
  const info = BROKER_REGISTRY[provider];
  const missingEnv = info.envVarsRequired.filter(k => !process.env[k]);
  const isLive = provider !== 'PAPER' && missingEnv.length === 0;

  res.json({
    active: provider,
    mode: isLive ? 'LIVE' : 'PAPER',
    name: info.name,
    isLive,
    missingEnv,
    registry: BROKER_REGISTRY,
  });
});

// ── GET /api/system/broker/ping ────────────────────────────────────────────────
// Checks if the active broker's API base URL is reachable
systemRouter.get('/broker/ping', async (_req: Request, res: Response) => {
  const BROKER_PING_URLS: Record<string, string> = {
    ANGELONE: 'https://apiconnect.angelbroking.com',
    UPSTOX: 'https://api-v2.upstox.com',
    ZERODHA: 'https://api.kite.trade',
    FYERS: 'https://api.fyers.in',
    DHAN: 'https://api.dhan.co',
    SHOONYA: 'https://api.shoonya.com',
    PAPER: 'https://artha.ai',
  };

  const rawProvider = (process.env.BROKER_PROVIDER || 'PAPER').toUpperCase();
  const provider = BROKER_PING_URLS[rawProvider] ? rawProvider : 'PAPER';
  const pingUrl = BROKER_PING_URLS[provider];

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(pingUrl, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    res.json({ status: 'OK', broker: provider, url: pingUrl, latencyMs: Date.now() - start });
  } catch (err: any) {
    res.json({ status: err.name === 'AbortError' ? 'TIMEOUT' : 'ERROR', broker: provider, url: pingUrl, latencyMs: Date.now() - start, error: err.message });
  }
});

// ── POST /api/system/broker/connect ───────────────────────────────────────────
// Manually update broker provider, credentials, and mode directly from UI
systemRouter.post('/broker/connect', async (req: Request, res: Response) => {
  const { provider, credentials, mode } = req.body ?? {};
  const upperProvider = String(provider || 'PAPER').toUpperCase().trim();

  const BROKER_ENV_KEYS: Record<string, string[]> = {
    ANGELONE: ['ANGELONE_CLIENT_ID', 'ANGELONE_CLIENT_SECRET', 'ANGELONE_PASSWORD', 'ANGELONE_TOTP_SECRET'],
    UPSTOX: ['UPSTOX_ACCESS_TOKEN', 'UPSTOX_API_KEY', 'UPSTOX_API_SECRET'],
    ZERODHA: ['ZERODHA_API_KEY', 'ZERODHA_ACCESS_TOKEN', 'ZERODHA_API_SECRET'],
    FYERS: ['FYERS_APP_ID', 'FYERS_ACCESS_TOKEN'],
    DHAN: ['DHAN_CLIENT_ID', 'DHAN_ACCESS_TOKEN'],
    SHOONYA: ['SHOONYA_USER_ID', 'SHOONYA_SESSION_TOKEN', 'SHOONYA_API_KEY'],
    PAPER: [],
  };

  if (!BROKER_ENV_KEYS[upperProvider]) {
    return res.status(400).json({ error: `Invalid broker provider: ${upperProvider}` });
  }

  // 1. Set active provider in process.env
  process.env.BROKER_PROVIDER = upperProvider;

  // 2. Set credentials in process.env if provided
  if (credentials && typeof credentials === 'object') {
    Object.entries(credentials).forEach(([key, val]) => {
      if (typeof val === 'string' && val.trim()) {
        process.env[key] = val.trim();
      }
    });
  }

  // 3. Update CapitalVault mode if mode is passed
  if (mode === 'LIVE' || mode === 'PAPER') {
    try {
      const { capitalVault } = require('../../../../packages/phase5-strategy/src/vault/CapitalVault');
      capitalVault.setMode(mode);
    } catch { /* skip if vault not loaded */ }
  }

  // 4. Invalidate broker session caches so fresh login takes place
  try {
    const { clearSession, invalidateHoldingsCache } = require('../services/brokerSession');
    clearSession();
    invalidateHoldingsCache();
  } catch { /* skip */ }

  // 5. Log system notification & timeline
  try {
    const { pushNotification } = require('../services/notificationService');
    const { addEvent } = require('../services/systemTimeline');
    pushNotification({
      component: 'broker',
      severity: 'INFO',
      title: `Broker Connected: ${upperProvider}`,
      message: `Active broker updated to ${upperProvider} (${mode || 'PAPER'} mode) directly from Broker Settings.`,
    });
    addEvent('broker', `Broker credentials updated for ${upperProvider}`, 'INFO');
  } catch { /* skip */ }

  const requiredKeys = BROKER_ENV_KEYS[upperProvider];
  const missingEnv = requiredKeys.filter(k => !process.env[k]);
  const isLive = upperProvider !== 'PAPER' && missingEnv.length === 0;

  res.json({
    success: true,
    active: upperProvider,
    mode: isLive ? 'LIVE' : 'PAPER',
    isLive,
    missingEnv,
    message: `Successfully connected to ${upperProvider}!`,
  });
});


