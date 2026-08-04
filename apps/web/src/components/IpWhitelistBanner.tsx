/**
 * IpWhitelistBanner.tsx
 * Shows whenever a broker rejects an order because the server IP is not registered.
 * Provides a one-click copy of the server IP and a direct link to the broker's settings page.
 */

import { useEffect, useState } from 'react';

const API_BASE = '/api';

// Broker-specific IP whitelist URLs
const BROKER_WHITELIST_URLS: Record<string, { label: string; url: string }> = {
  ANGELONE: {
    label: 'Angel One SmartAPI',
    url: 'https://smartapi.angelbroking.com/enable-api',
  },
  UPSTOX: {
    label: 'Upstox Developer Portal',
    url: 'https://account.upstox.com/developer/apps',
  },
  ZERODHA: {
    label: 'Zerodha Kite Developer',
    url: 'https://developers.kite.trade/apps',
  },
  FYERS: {
    label: 'Fyers API Portal',
    url: 'https://myapi.fyers.in/dashboard',
  },
  DHAN: {
    label: 'Dhan Developer',
    url: 'https://dhanhq.co/developer',
  },
  SHOONYA: {
    label: 'Shoonya API Registration',
    url: 'https://api.shoonya.com/#register',
  },
};

interface IpWhitelistBannerProps {
  /** Pass the serverIp from the order response, or leave undefined to auto-fetch */
  serverIp?: string | null;
  brokerProvider?: string;
  onDismiss?: () => void;
}

export function IpWhitelistBanner({ serverIp: propIp, brokerProvider = 'ANGELONE', onDismiss }: IpWhitelistBannerProps) {
  const [serverIp, setServerIp] = useState<string>(propIp || '');
  const [copied, setCopied] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!propIp) {
      // Auto-fetch if not passed in
      setFetching(true);
      fetch(`${API_BASE}/system/server-ip`)
        .then(r => r.json())
        .then(d => setServerIp(d.ip || 'Unable to detect'))
        .catch(() => setServerIp('Unable to detect'))
        .finally(() => setFetching(false));
    } else {
      setServerIp(propIp);
    }
  }, [propIp]);

  const handleCopy = () => {
    navigator.clipboard.writeText(serverIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const broker = BROKER_WHITELIST_URLS[brokerProvider.toUpperCase()] || BROKER_WHITELIST_URLS.ANGELONE;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(239,68,68,0.05) 100%)',
      border: '1px solid rgba(245,158,11,0.4)',
      borderRadius: 14,
      padding: '18px 20px',
      marginBottom: 20,
      position: 'relative',
    }}>
      {/* Dismiss button */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            position: 'absolute', top: 12, right: 14,
            background: 'transparent', border: 'none',
            color: 'var(--muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1,
          }}
        >
          ×
        </button>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 22 }}>🌐</span>
        <div>
          <div style={{ fontWeight: 700, color: '#f59e0b', fontSize: 14 }}>
            IP Address Not Whitelisted
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {broker.label} rejected your order because this server's IP is not registered.
          </div>
        </div>
      </div>

      {/* Step-by-step fix */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Step 1 — Copy IP */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: '12px 16px',
          border: '1px solid rgba(245,158,11,0.2)',
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: '#f59e0b', color: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 800, flexShrink: 0,
          }}>1</div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
              Your server's public IP address:
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{
                fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                color: '#fbbf24', letterSpacing: 1,
              }}>
                {fetching ? 'Fetching…' : serverIp}
              </code>
              <button
                onClick={handleCopy}
                disabled={fetching || !serverIp}
                style={{
                  padding: '4px 12px', fontSize: 11, borderRadius: 6,
                  background: copied ? '#059669' : '#f59e0b',
                  border: 'none', color: '#000', fontWeight: 700, cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
              >
                {copied ? '✓ Copied!' : '📋 Copy IP'}
              </button>
            </div>
          </div>
        </div>

        {/* Step 2 — Open broker portal */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: '12px 16px',
          border: '1px solid rgba(245,158,11,0.2)',
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: '#f59e0b', color: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 800, flexShrink: 0,
          }}>2</div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
              Go to your broker's API developer settings and add the IP above:
            </div>
            <a
              href={broker.url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8,
                background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
                color: '#fbbf24', fontSize: 12, fontWeight: 700,
                textDecoration: 'none', transition: 'background 0.2s',
              }}
            >
              🔗 Open {broker.label} ↗
            </a>
          </div>
        </div>

        {/* Step 3 — Restart */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: '12px 16px',
          border: '1px solid rgba(245,158,11,0.2)',
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: '#f59e0b', color: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 800, flexShrink: 0,
          }}>3</div>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--muted)' }}>
            After saving, <strong style={{ color: '#fff' }}>wait 2–5 minutes</strong> for the IP to propagate,
            then try placing your order again. No server restart needed.
          </div>
        </div>

        {/* Warning about dynamic IPs */}
        <div style={{
          fontSize: 11, color: 'rgba(245,158,11,0.7)', marginTop: 4,
          padding: '8px 12px', background: 'rgba(245,158,11,0.05)', borderRadius: 8,
          border: '1px solid rgba(245,158,11,0.15)',
        }}>
          ⚠️ <strong>Important:</strong> If you're using a cloud host (Render, Railway, etc.) or ISP that
          changes your IP, you'll need to re-whitelist it whenever the IP changes.
          Consider using a <strong>static IP VPS</strong> for reliable live trading.
        </div>
      </div>
    </div>
  );
}
