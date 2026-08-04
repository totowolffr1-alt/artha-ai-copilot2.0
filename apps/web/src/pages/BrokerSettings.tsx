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

export default function BrokerSettings() {
  const [info, setInfo] = useState<BrokerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [ping, setPing] = useState<{ latency: number; status: string } | null>(null);
  const [pinging, setPinging] = useState(false);

  const fetchBrokerInfo = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/system/broker`);
      const data = await res.json();
      setInfo(data);
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

  useEffect(() => { fetchBrokerInfo(); }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0', color: 'var(--muted)' }}>
        Loading broker info…
      </div>
    );
  }

  const activeColor = info ? (BROKER_COLORS[info.active] || '#6b7280') : '#6b7280';

  return (
    <div>
      <h2>Broker Settings <span className="badge">MULTI-BROKER</span></h2>
      <p className="description">
        Artha AI supports 6 Indian brokers with a single-line config change.
        Switch <code>BROKER_PROVIDER</code> in your <code>.env</code> to go live.
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
                Active Broker
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
                    ✅ All credentials set
                  </span>
                ) : (
                  <span style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                  }}>
                    ⚠️ {info.missingEnv.length} missing env var{info.missingEnv.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {info.missingEnv.length > 0 && (
                <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(245,158,11,0.07)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.2)' }}>
                  <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, marginBottom: 4 }}>Missing in .env:</div>
                  {info.missingEnv.map(k => (
                    <code key={k} style={{ display: 'block', fontSize: 11, color: '#fbbf24', fontFamily: 'monospace' }}>{k}</code>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
              <button onClick={handlePing} disabled={pinging} style={{ minWidth: 120 }}>
                {pinging ? '⏳ Pinging…' : '🌐 Ping Broker'}
              </button>
              {ping && (
                <div style={{
                  padding: '8px 14px', borderRadius: 8, fontSize: 12,
                  background: ping.status === 'OK' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${ping.status === 'OK' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  color: ping.status === 'OK' ? '#10b981' : '#ef4444',
                }}>
                  {ping.status === 'OK' ? '✅' : '❌'} {ping.latency}ms
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* How to switch */}
      <div className="card" style={{ marginBottom: 28, padding: 20, background: 'rgba(167,139,250,0.03)', border: '1px solid rgba(167,139,250,0.2)' }}>
        <h4 style={{ color: '#fff', margin: '0 0 12px', fontSize: 14 }}>🔧 How to Switch Brokers</h4>
        <ol style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
          <li>Open <code>.env</code> in your project root</li>
          <li>Change <code>BROKER_PROVIDER=ANGELONE</code> to your desired broker</li>
          <li>Fill in the credentials for that broker (see keys below)</li>
          <li>Restart the dev server: <code>npm run dev</code></li>
        </ol>
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(0,0,0,0.3)', borderRadius: 8, fontFamily: 'monospace', fontSize: 12, color: '#a78bfa' }}>
          BROKER_PROVIDER=ZERODHA<br />
          ZERODHA_API_KEY=your_key<br />
          ZERODHA_ACCESS_TOKEN=your_token
        </div>
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
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Required .env keys</div>
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
