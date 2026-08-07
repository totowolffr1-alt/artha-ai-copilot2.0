import { useEffect, useState } from 'react';

const API_BASE = '/api';

interface BrokerInfo {
  active: string;
  mode: string;
  name: string;
  isLive: boolean;
  missingEnv: string[];
  registry: Record<string, {
    name: string;
    website: string;
    apiDocs: string;
    brokerageModel: string;
    supportedSegments: string[];
    envVarsRequired: string[];
  }>;
}

const BROKER_COLORS: Record<string, string> = {
  ANGELONE: '#ff6b35',
  UPSTOX:   '#7c3aed',
  ZERODHA:  '#387ed1',
  FYERS:    '#e63946',
  DHAN:     '#0ea5e9',
  SHOONYA:  '#10b981',
  PAPER:    '#6b7280',
};

const BROKER_ICONS: Record<string, string> = {
  ANGELONE: '🦅',
  UPSTOX:   '⚡',
  ZERODHA:  '🔷',
  FYERS:    '🦊',
  DHAN:     '🏦',
  SHOONYA:  '✨',
  PAPER:    '📄',
};

// Human-friendly field labels
const FIELD_LABELS: Record<string, string> = {
  ANGELONE_CLIENT_ID:      'Angel One Client ID (e.g. A123456)',
  ANGELONE_CLIENT_SECRET:  'Angel One API Key (SmartAPI Key)',
  ANGELONE_PASSWORD:       'Angel One PIN / Password',
  ANGELONE_TOTP_SECRET:    'Angel One TOTP Secret Key (from Authenticator)',

  UPSTOX_ACCESS_TOKEN:     'Upstox Access Token',
  UPSTOX_API_KEY:          'Upstox API Key',
  UPSTOX_API_SECRET:       'Upstox API Secret',

  ZERODHA_API_KEY:         'Zerodha Kite API Key',
  ZERODHA_ACCESS_TOKEN:    'Zerodha Kite Access Token',
  ZERODHA_API_SECRET:      'Zerodha Kite API Secret',

  FYERS_APP_ID:            'Fyers App ID',
  FYERS_ACCESS_TOKEN:      'Fyers Access Token',

  DHAN_CLIENT_ID:          'Dhan Client ID',
  DHAN_ACCESS_TOKEN:       'Dhan Access Token',

  SHOONYA_USER_ID:         'Shoonya User ID',
  SHOONYA_SESSION_TOKEN:   'Shoonya Session Token / Password',
  SHOONYA_API_KEY:         'Shoonya API Key',
};

export default function BrokerSettings() {
  const [info, setInfo] = useState<BrokerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [ping, setPing] = useState<{ latency: number; status: string } | null>(null);
  const [pinging, setPinging] = useState(false);

  // Manual configuration form states
  const [selectedBroker, setSelectedBroker] = useState<string>('ANGELONE');
  const [formCredentials, setFormCredentials] = useState<Record<string, string>>({});
  const [selectedMode, setSelectedMode] = useState<'PAPER' | 'LIVE'>('PAPER');
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ success?: boolean; message?: string } | null>(null);

  const fetchBrokerInfo = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/system/broker`);
      const data: BrokerInfo = await res.json();
      setInfo(data);
      if (data?.active) {
        setSelectedBroker(data.active);
        setSelectedMode(data.mode === 'LIVE' ? 'LIVE' : 'PAPER');
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const handlePing = async () => {
    setPinging(true);
    const t = Date.now();
    try {
      const res = await fetch(`${API_BASE}/system/broker/ping`);
      const data = await res.json();
      setPing({ latency: Date.now() - t, status: data.status });
    } catch {
      setPing({ latency: Date.now() - t, status: 'ERROR' });
    } finally {
      setPinging(false);
    }
  };

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveStatus(null);
    try {
      const res = await fetch(`${API_BASE}/system/broker/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedBroker,
          credentials: formCredentials,
          mode: selectedMode,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSaveStatus({ success: true, message: data.message || `Successfully connected to ${selectedBroker}!` });
        await fetchBrokerInfo();
        handlePing();
      } else {
        setSaveStatus({ success: false, message: data.error || 'Failed to connect broker' });
      }
    } catch (err: any) {
      setSaveStatus({ success: false, message: err?.message || 'Network error while connecting broker' });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => { fetchBrokerInfo(); }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0', color: 'var(--muted)' }}>
        Loading broker info…
      </div>
    );
  }

  const activeColor = info ? (BROKER_COLORS[info.active] || '#6b7280') : '#6b7280';
  const currentRegistry = info?.registry[selectedBroker];
  const requiredKeys = currentRegistry?.envVarsRequired || [];

  return (
    <div>
      <h2>Broker Settings <span className="badge">MULTI-BROKER</span></h2>
      <p className="description">
        Connect your broker account manually to enable live stock quotes, portfolio syncing, and autonomous trading.
      </p>

      {/* Active Broker Card */}
      {info && (
        <div className="card" style={{
          marginBottom: 28,
          padding: 24,
          border: `1px solid ${activeColor}40`,
          background: `linear-gradient(135deg, ${activeColor}08 0%, rgba(0,0,0,0) 100%)`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                Active Broker Connection
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <span style={{ fontSize: 32 }}>{BROKER_ICONS[info.active] || '🏦'}</span>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{info.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{info.active}</div>
                </div>
              </div>

              {/* Status badges */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: info.isLive ? 'rgba(239,68,68,0.15)' : 'rgba(107,114,128,0.15)',
                  color: info.isLive ? '#ef4444' : '#9ca3af',
                }}>
                  {info.isLive ? '🔴 LIVE MODE' : '📄 PAPER MODE'}
                </span>

                {info.missingEnv.length === 0 ? (
                  <span style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: 'rgba(16,185,129,0.15)', color: '#10b981',
                  }}>
                    ✅ All credentials set & connected
                  </span>
                ) : (
                  <span style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                  }}>
                    ⚠️ {info.missingEnv.length} credential key{info.missingEnv.length > 1 ? 's' : ''} missing
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
              <button onClick={handlePing} disabled={pinging} style={{ minWidth: 120 }}>
                {pinging ? '⏳ Pinging…' : '🌐 Ping Broker API'}
              </button>
              {ping && (
                <div style={{
                  padding: '8px 14px', borderRadius: 8, fontSize: 12,
                  background: ping.status === 'OK' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${ping.status === 'OK' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  color: ping.status === 'OK' ? '#10b981' : '#ef4444',
                }}>
                  {ping.status === 'OK' ? '✅' : '❌'} {ping.latency}ms ({ping.status})
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manual Connection Form Card */}
      <div className="card" style={{ marginBottom: 32, padding: 24, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.02)' }}>
        <h3 style={{ color: '#fff', fontSize: 18, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🔑</span> Connect Broker App Manually
        </h3>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
          Select your Indian broker app, enter your API credentials manually below, and click Connect.
        </p>

        {/* Broker Selector Badges */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>Choose Broker:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {info && Object.keys(info.registry).map(key => {
              const isSel = key === selectedBroker;
              const col = BROKER_COLORS[key] || '#6b7280';
              const icon = BROKER_ICONS[key] || '🏦';

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedBroker(key)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: isSel ? `${col}25` : 'rgba(255,255,255,0.04)',
                    border: `1.5px solid ${isSel ? col : 'rgba(255,255,255,0.1)'}`,
                    color: isSel ? '#fff' : 'var(--muted)',
                    boxShadow: isSel ? `0 0 12px ${col}30` : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{icon}</span>
                  <span>{info.registry[key].name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Connection Form */}
        <form onSubmit={handleSaveConnection}>
          {/* Mode Selection */}
          <div style={{ marginBottom: 20, padding: 14, background: 'rgba(0,0,0,0.2)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>Trading Execution Mode:</div>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#fff' }}>
                <input
                  type="radio"
                  name="tradingMode"
                  value="PAPER"
                  checked={selectedMode === 'PAPER'}
                  onChange={() => setSelectedMode('PAPER')}
                />
                <span>📄 Paper Trading (Risk-Free Simulation)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#ef4444', fontWeight: 600 }}>
                <input
                  type="radio"
                  name="tradingMode"
                  value="LIVE"
                  checked={selectedMode === 'LIVE'}
                  onChange={() => setSelectedMode('LIVE')}
                />
                <span>🔴 Live Real Orders (Angel One / Connected Broker)</span>
              </label>
            </div>
          </div>

          {/* Credential Inputs */}
          {requiredKeys.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>
              {requiredKeys.map(key => {
                const label = FIELD_LABELS[key] || key;
                const isSecret = key.includes('SECRET') || key.includes('PASSWORD') || key.includes('TOKEN') || key.includes('PIN');
                const isShown = !!showSecrets[key];

                return (
                  <div key={key}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>
                      {label}
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={isSecret && !isShown ? 'password' : 'text'}
                        value={formCredentials[key] || ''}
                        placeholder={`Enter ${key}...`}
                        onChange={e => setFormCredentials({ ...formCredentials, [key]: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          paddingRight: isSecret ? 40 : 12,
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          color: '#fff',
                          fontSize: 13,
                          fontFamily: 'monospace',
                        }}
                      />
                      {isSecret && (
                        <button
                          type="button"
                          onClick={() => setShowSecrets({ ...showSecrets, [key]: !isShown })}
                          style={{
                            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                            background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer',
                            fontSize: 14, padding: 4,
                          }}
                        >
                          {isShown ? '🙈' : '👁️'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '14px 16px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, marginBottom: 20, color: '#10b981', fontSize: 13 }}>
              ✨ <strong>Paper Trading Mode Selected:</strong> No API credentials required. You can test strategies risk-free immediately!
            </div>
          )}

          {/* Toast / Save Status */}
          {saveStatus && (
            <div style={{
              padding: '12px 16px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 13,
              fontWeight: 600,
              background: saveStatus.success ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              border: `1px solid ${saveStatus.success ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: saveStatus.success ? '#10b981' : '#ef4444',
            }}>
              {saveStatus.success ? '✅' : '❌'} {saveStatus.message}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '10px 24px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(99,102,241,0.4)',
              }}
            >
              {saving ? '⏳ Connecting…' : `⚡ Save & Connect ${selectedBroker}`}
            </button>
          </div>
        </form>
      </div>

      {/* Broker Registry Grid */}
      <h3 style={{ color: '#fff', fontSize: 16, marginBottom: 16 }}>All Supported Brokers</h3>
      {info && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 16 }}>
          {Object.entries(info.registry).map(([key, broker]) => {
            const isActive = key === info.active;
            const color = BROKER_COLORS[key] || '#6b7280';
            const icon = BROKER_ICONS[key] || '🏦';

            return (
              <div
                key={key}
                className="card"
                style={{
                  padding: '18px 20px',
                  border: isActive ? `2px solid ${color}` : '1px solid var(--border)',
                  background: isActive ? `${color}08` : 'rgba(255,255,255,0.02)',
                  position: 'relative',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  boxShadow: isActive ? `0 0 20px ${color}20` : 'none',
                }}
              >
                {isActive && (
                  <div style={{
                    position: 'absolute', top: 10, right: 12,
                    fontSize: 10, padding: '2px 8px', borderRadius: 20,
                    background: `${color}30`, color: color, fontWeight: 700,
                  }}>
                    ACTIVE
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 24 }}>{icon}</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>{broker.name}</div>
                    <a
                      href={broker.website}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 11, color: color, textDecoration: 'none' }}
                    >
                      {broker.website.replace('https://', '')} ↗
                    </a>
                  </div>
                </div>

                {/* Brokerage model */}
                <div style={{
                  padding: '6px 10px', borderRadius: 6, marginBottom: 10,
                  background: key === 'SHOONYA' || key === 'PAPER' ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
                  border: key === 'SHOONYA' || key === 'PAPER' ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>Brokerage</div>
                  <div style={{
                    fontSize: 12, fontWeight: 600,
                    color: key === 'SHOONYA' || key === 'PAPER' ? '#10b981' : '#fff',
                  }}>
                    {broker.brokerageModel}
                  </div>
                </div>

                {/* Segments */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                  {broker.supportedSegments.map(seg => (
                    <span key={seg} style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 12,
                      background: 'rgba(255,255,255,0.06)', color: 'var(--muted)',
                    }}>
                      {seg}
                    </span>
                  ))}
                </div>

                {/* Required env vars */}
                {broker.envVarsRequired.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Required Credential Keys</div>
                    {broker.envVarsRequired.map(k => (
                      <code key={k} style={{
                        display: 'block', fontSize: 10, fontFamily: 'monospace',
                        color: '#a78bfa', marginBottom: 2,
                      }}>
                        {k}
                      </code>
                    ))}
                  </div>
                )}

                <a
                  href={broker.apiDocs}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'block', marginTop: 12, fontSize: 11,
                    color: color, textDecoration: 'none', fontWeight: 600,
                  }}
                >
                  📖 API Documentation ↗
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
