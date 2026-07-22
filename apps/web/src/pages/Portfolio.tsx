import { useState, useEffect } from 'react';
import MarketSessionBanner from '../components/MarketSessionBanner';

const BASE = '/api';

interface Holding {
  symbol: string;
  qty: number;
  avgPrice: number;
  ltp: number;
  pnl: number;
  pnlPct: number;
  currentValue: number;
}

interface PortfolioData {
  connected: boolean;
  broker: string | null;
  totalValue: number;
  todayPnl: number;
  overallPnl: number;
  availableFunds: number;
  holdings: Holding[];
  error?: string;
}

export default function Portfolio() {
  const [data, setData] = useState<PortfolioData>({
    connected: false,
    broker: null,
    totalValue: 0,
    todayPnl: 0,
    overallPnl: 0,
    availableFunds: 0,
    holdings: [],
  });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchPortfolio = async () => {
    try {
      const res = await fetch(`${BASE}/portfolio`);
      const json = await res.json();
      setData(json);
      if (json.error) setErrorMessage(json.error);
    } catch {
      setErrorMessage('Could not fetch portfolio status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPortfolio();
  }, []);

  const handleConnect = async (broker: string) => {
    setErrorMessage('');
    setConnecting(true);

    try {
      const res = await fetch(`${BASE}/portfolio/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker }),
      });
      const json = await res.json();

      if (json.success) {
        setData(json);
        if (json.error) setErrorMessage(json.error);
      } else {
        setErrorMessage(json.message || 'Connection failed.');
      }
    } catch {
      setErrorMessage('Failed to connect to backend server.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch(`${BASE}/portfolio/disconnect`, { method: 'POST' });
      setData({
        connected: false,
        broker: null,
        totalValue: 0,
        todayPnl: 0,
        overallPnl: 0,
        availableFunds: 0,
        holdings: [],
      });
      setErrorMessage('');
    } catch {}
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading portfolio…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>💼 Portfolio <span className="badge">{data.connected ? 'CONNECTED' : 'DISCONNECTED'}</span></h2>
        {data.connected && (
          <button onClick={handleDisconnect} className="secondary" style={{ fontSize: 12, padding: '6px 14px', color: '#f87171' }}>
            🔌 Disconnect Broker
          </button>
        )}
      </div>

      <MarketSessionBanner />

      {(errorMessage || data.error) && (
        <div style={{
          padding: '14px 18px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 10, color: '#f87171', marginBottom: 20, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <strong>⚠️ Broker Status Notice:</strong> {errorMessage || data.error}
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Tip: Ensure your API Key on <code style={{ color: '#fff' }}>smartapi.angelone.in</code> has Portfolio/Trade permissions enabled. Set <code style={{ color: '#fff' }}>DEMO_MODE=true</code> in <code style={{ color: '#fff' }}>.env</code> anytime for sample portfolio testing.
            </div>
          </div>
          <button onClick={() => { setErrorMessage(''); setData(d => ({ ...d, error: undefined })); }} className="secondary" style={{ padding: '2px 8px', fontSize: 12 }}>✕</button>
        </div>
      )}

      {!data.connected ? (
        /* ── No Broker Connected State ── */
        <div style={{ maxWidth: 640, margin: '40px auto', textAlign: 'center' }}>
          <div className="card" style={{ padding: 44 }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🔗</div>
            <h3 style={{ fontSize: 22, color: '#fff', marginBottom: 10 }}>No Broker Connected</h3>
            <p style={{ color: 'var(--muted)', marginBottom: 30, lineHeight: 1.6, fontSize: 14 }}>
              Connect your Angel One SmartAPI account to view real demat holdings, positions, and live P&L.
              Your credentials are kept secure in your local environment.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                onClick={() => handleConnect('angelone')}
                disabled={connecting}
                style={{ padding: '14px 24px', fontSize: 15, justifyContent: 'center' }}
              >
                {connecting ? '⏳ Authenticating SmartAPI…' : '🔐 Connect Angel One (SmartAPI)'}
              </button>
              <button onClick={() => handleConnect('groww')} className="secondary" style={{ padding: '12px 24px', fontSize: 14 }}>
                🌱 Connect Groww (OAuth)
              </button>
              <button onClick={() => handleConnect('zerodha')} className="secondary" style={{ padding: '12px 24px', fontSize: 14 }}>
                ⚡ Connect Zerodha (Kite API)
              </button>
            </div>

            <div style={{ marginTop: 28, padding: 16, background: 'rgba(99,102,241,0.08)', borderRadius: 10, border: '1px solid rgba(99,102,241,0.2)', textAlign: 'left' }}>
              <div style={{ fontSize: 13, color: '#a78bfa', fontWeight: 600, marginBottom: 6 }}>ℹ️ Credentials Setup</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                Your Angel One keys (<code style={{ color: '#fff' }}>SMARTAPI_CLIENT_ID</code> and <code style={{ color: '#fff' }}>SMARTAPI_API_KEY</code>) are configured in <code style={{ color: '#fff' }}>.env</code>.
                Clicking <strong>Connect Angel One</strong> validates your credentials against the API.
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Connected State ── */
        <div>
          {/* Active Broker Badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px',
            background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: 10, marginBottom: 24, fontSize: 13, color: '#34d399',
          }}>
            <span>🟢</span>
            <strong>Active Broker: {data.broker}</strong>
            <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>Syncing live demat positions</span>
          </div>

          <div className="grid">
            <div className="card stat-container">
              <div className="stat-label">Total Portfolio Value</div>
              <div className="stat-value" style={{ color: '#fff' }}>₹{data.totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Demat Holdings</div>
            </div>

            <div className="card stat-container">
              <div className="stat-label">Today's P&L</div>
              <div className="stat-value" style={{ color: data.todayPnl >= 0 ? '#10b981' : '#ef4444' }}>
                {data.todayPnl >= 0 ? '+' : ''}₹{data.todayPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Unrealized intraday</div>
            </div>

            <div className="card stat-container">
              <div className="stat-label">Overall P&L</div>
              <div className="stat-value" style={{ color: data.overallPnl >= 0 ? '#10b981' : '#ef4444' }}>
                {data.overallPnl >= 0 ? '+' : ''}₹{data.overallPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Total holdings profit</div>
            </div>

            <div className="card stat-container">
              <div className="stat-label">Available Cash Funds</div>
              <div className="stat-value" style={{ color: '#a78bfa' }}>₹{data.availableFunds.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Trading Margin</div>
            </div>
          </div>

          {/* Holdings Table */}
          <div className="card">
            <h3 style={{ marginBottom: 16, color: '#fff', fontSize: 16 }}>Demat Holdings ({data.holdings.length})</h3>
            {data.holdings.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>
                No holdings returned from broker account.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Avg Price</th>
                    <th style={{ textAlign: 'right' }}>LTP</th>
                    <th style={{ textAlign: 'right' }}>Current Value</th>
                    <th style={{ textAlign: 'right' }}>P&L (₹)</th>
                    <th style={{ textAlign: 'right' }}>P&L (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.holdings.map(h => (
                    <tr key={h.symbol}>
                      <td><strong style={{ color: '#fff' }}>{h.symbol}</strong></td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{h.qty}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>₹{h.avgPrice.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>₹{h.ltp.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#fff' }}>
                        ₹{h.currentValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }} className={h.pnl >= 0 ? 'price-up' : 'price-down'}>
                        {h.pnl >= 0 ? '+' : ''}₹{h.pnl.toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }} className={h.pnlPct >= 0 ? 'price-up' : 'price-down'}>
                        {h.pnlPct >= 0 ? '+' : ''}{h.pnlPct.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
