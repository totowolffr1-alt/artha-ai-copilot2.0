import { useEffect, useState } from 'react';

const API_BASE = '/api';

interface SandboxSummary {
  id: 'MICRO' | 'MACRO';
  label: string;
  initialCapital: number;
  currentCapital: number;
  availableCash: number;
  investedValue: number;
  totalPnL: number;
  totalPnLPct: number;
  openPositions: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  maxDrawdown: number;
  peakCapital: number;
  allowedStrategies: string[];
}

interface SandboxTrade {
  id: string;
  symbol: string;
  direction: string;
  qty: number;
  price: number;
  strategy: string;
  status: string;
  pnl?: number;
  pnlPct?: number;
  entryTime: string;
  sandbox: string;
  confidence?: number;
  thresholdReasoning: string;
  rejectionReason?: string;
}

interface TradeForm {
  symbol: string;
  direction: 'BUY' | 'SELL';
  qty: string;
  price: string;
  strategy: string;
}

export default function SandboxPage() {
  const [microSummary, setMicroSummary] = useState<SandboxSummary | null>(null);
  const [macroSummary, setMacroSummary] = useState<SandboxSummary | null>(null);
  const [activeSandbox, setActiveSandbox] = useState<'MICRO' | 'MACRO'>('MICRO');
  const [trades, setTrades] = useState<SandboxTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [form, setForm] = useState<TradeForm>({
    symbol: 'RELIANCE',
    direction: 'BUY',
    qty: '1',
    price: '2950',
    strategy: 'DELIVERY',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [summaryRes, tradesRes] = await Promise.all([
        fetch(`${API_BASE}/sandbox`),
        fetch(`${API_BASE}/sandbox/${activeSandbox}/trades`),
      ]);
      const summary = await summaryRes.json();
      const tradesData = await tradesRes.json();

      setMicroSummary(summary.micro);
      setMacroSummary(summary.macro);
      setTrades(tradesData.trades ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [activeSandbox]);

  const handleTrade = async () => {
    setTradeLoading(true);
    try {
      const res = await fetch(`${API_BASE}/sandbox/${activeSandbox}/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: form.symbol.toUpperCase(),
          direction: form.direction,
          qty: parseFloat(form.qty),
          price: parseFloat(form.price),
          strategy: form.strategy,
        }),
      });
      const data = await res.json();
      setLastResult(data);
      fetchData();
    } catch (err: any) {
      setLastResult({ error: err.message });
    } finally {
      setTradeLoading(false);
    }
  };

  const handleReset = async (id: 'MICRO' | 'MACRO') => {
    await fetch(`${API_BASE}/sandbox/${id}/reset`, { method: 'POST' });
    fetchData();
  };

  const activeSummary = activeSandbox === 'MICRO' ? microSummary : macroSummary;

  const StatCard = ({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) => (
    <div className="card stat-container" style={{ minWidth: 130, flex: 1 }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 20, color: color ?? '#fff' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <h2>Dual Sandbox <span className="badge">PAPER TRADING</span></h2>
      <p className="description">
        Two parallel paper trading simulations with AI dynamic sizing. Micro trains low-capital survival. Macro trains full portfolio strategies.
      </p>

      {/* Sandbox Switcher */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {(['MICRO', 'MACRO'] as const).map(id => {
          const s = id === 'MICRO' ? microSummary : macroSummary;
          const isActive = activeSandbox === id;
          const pnlColor = (s?.totalPnL ?? 0) >= 0 ? 'var(--green)' : 'var(--red)';
          return (
            <button
              key={id}
              onClick={() => setActiveSandbox(id)}
              style={{
                flex: 1,
                padding: '16px 20px',
                borderRadius: 12,
                border: isActive ? '2px solid #a78bfa' : '1px solid var(--border)',
                background: isActive ? 'rgba(167, 139, 250, 0.1)' : 'rgba(255,255,255,0.03)',
                color: '#fff',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                {id === 'MICRO' ? '🔬' : '🏦'} {s?.label ?? `${id} Sandbox`}
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                <span style={{ color: 'var(--muted)' }}>Capital: <span style={{ color: '#fff' }}>₹{s?.currentCapital?.toFixed(0) ?? '…'}</span></span>
                <span style={{ color: 'var(--muted)' }}>P&L: <span style={{ color: pnlColor }}>₹{s?.totalPnL?.toFixed(2) ?? '0'}</span></span>
                <span style={{ color: 'var(--muted)' }}>Win: <span style={{ color: '#10b981' }}>{s?.winRate ?? 0}%</span></span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Stats Row */}
      {activeSummary && (
        <div className="grid" style={{ marginBottom: 24 }}>
          <StatCard
            label="Current Capital"
            value={`₹${activeSummary.currentCapital.toFixed(2)}`}
            sub={`Started: ₹${activeSummary.initialCapital.toLocaleString()}`}
            color={activeSummary.totalPnL >= 0 ? 'var(--green)' : 'var(--red)'}
          />
          <StatCard
            label="Total P&L"
            value={`${activeSummary.totalPnL >= 0 ? '+' : ''}₹${activeSummary.totalPnL.toFixed(2)}`}
            sub={`${activeSummary.totalPnLPct >= 0 ? '+' : ''}${activeSummary.totalPnLPct}%`}
            color={activeSummary.totalPnL >= 0 ? 'var(--green)' : 'var(--red)'}
          />
          <StatCard label="Win Rate" value={`${activeSummary.winRate}%`} sub={`${activeSummary.winCount}W / ${activeSummary.lossCount}L`} color="#a78bfa" />
          <StatCard label="Available Cash" value={`₹${activeSummary.availableCash.toFixed(2)}`} sub="Ready to deploy" />
          <StatCard label="Max Drawdown" value={`${activeSummary.maxDrawdown}%`} sub="From peak" color={activeSummary.maxDrawdown > 10 ? 'var(--red)' : 'var(--green)'} />
          <StatCard label="Open Positions" value={String(activeSummary.openPositions)} sub={`${activeSummary.totalTrades} total trades`} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Place Trade */}
        <div className="card" style={{ width: 320, padding: 20, flexShrink: 0 }}>
          <h4 style={{ color: '#fff', marginBottom: 16, fontSize: 14 }}>
            📋 Place Paper Trade — {activeSandbox}
          </h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Symbol</label>
              <input value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value })}
                placeholder="e.g. RELIANCE" style={{ width: '100%' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['BUY', 'SELL'] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setForm({ ...form, direction: d })}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: 8,
                    border: form.direction === d
                      ? `2px solid ${d === 'BUY' ? '#10b981' : '#ef4444'}`
                      : '1px solid var(--border)',
                    background: form.direction === d
                      ? `${d === 'BUY' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`
                      : 'transparent',
                    color: d === 'BUY' ? '#10b981' : '#ef4444',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {d === 'BUY' ? '▲ BUY' : '▼ SELL'}
                </button>
              ))}
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Price (₹)</label>
              <input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Quantity</label>
              <input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Strategy</label>
              <select
                value={form.strategy}
                onChange={e => setForm({ ...form, strategy: e.target.value })}
                style={{ width: '100%', padding: '8px', background: 'var(--card)', color: '#fff', border: '1px solid var(--border)', borderRadius: 8 }}
              >
                {(activeSandbox === 'MICRO'
                  ? ['DELIVERY', 'SWING']
                  : ['DELIVERY', 'INTRADAY', 'OPTIONS', 'SWING']
                ).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Order value preview */}
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--muted)' }}>Order Value</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>₹{(parseFloat(form.price || '0') * parseFloat(form.qty || '0')).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)' }}>Brokerage</span>
                <span style={{ color: form.strategy === 'DELIVERY' || form.strategy === 'SWING' ? '#10b981' : '#f59e0b' }}>
                  {form.strategy === 'DELIVERY' || form.strategy === 'SWING' ? '₹0 (Free)' : '₹20'}
                </span>
              </div>
            </div>

            <button
              onClick={handleTrade}
              disabled={tradeLoading}
              style={{
                width: '100%',
                background: form.direction === 'BUY'
                  ? 'linear-gradient(135deg, #10b981, #059669)'
                  : 'linear-gradient(135deg, #ef4444, #dc2626)',
                border: 'none',
                padding: '12px',
                borderRadius: 8,
                color: '#fff',
                fontWeight: 700,
                cursor: tradeLoading ? 'not-allowed' : 'pointer',
                opacity: tradeLoading ? 0.6 : 1,
              }}
            >
              {tradeLoading ? '⏳ Processing…' : `${form.direction} ${form.symbol || 'Symbol'}`}
            </button>

            {/* Result */}
            {lastResult && (
              <div style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: lastResult.trade?.status === 'REJECTED' || lastResult.error
                  ? 'rgba(239,68,68,0.1)'
                  : 'rgba(16,185,129,0.1)',
                border: `1px solid ${lastResult.trade?.status === 'REJECTED' || lastResult.error ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
                fontSize: 11,
              }}>
                {lastResult.error ? (
                  <span style={{ color: '#ef4444' }}>❌ {lastResult.error}</span>
                ) : lastResult.trade?.status === 'REJECTED' ? (
                  <span style={{ color: '#ef4444' }}>❌ {lastResult.trade.rejectionReason}</span>
                ) : (
                  <span style={{ color: '#10b981' }}>✅ {lastResult.trade?.direction} {lastResult.trade?.qty}×{lastResult.trade?.symbol} @ ₹{lastResult.trade?.price}</span>
                )}
                {lastResult.trade?.thresholdReasoning && (
                  <div style={{ color: 'var(--muted)', marginTop: 4 }}>{lastResult.trade.thresholdReasoning}</div>
                )}
              </div>
            )}

            <button
              onClick={() => handleReset(activeSandbox)}
              style={{
                width: '100%',
                background: 'transparent',
                border: '1px solid rgba(239,68,68,0.3)',
                padding: '8px',
                borderRadius: 8,
                color: '#ef4444',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              🔄 Reset {activeSandbox} Sandbox
            </button>
          </div>
        </div>

        {/* Trade History */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ color: '#fff', fontSize: 16, margin: 0 }}>Trade History — {activeSandbox}</h3>
            {loading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</span>}
          </div>

          {trades.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              No trades yet. Place your first paper trade!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {trades.map(trade => (
                <div key={trade.id} className="card" style={{
                  padding: '12px 16px',
                  border: trade.status === 'REJECTED'
                    ? '1px solid rgba(239,68,68,0.2)'
                    : trade.pnl && trade.pnl >= 0
                    ? '1px solid rgba(16,185,129,0.2)'
                    : '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: trade.direction === 'BUY' ? '#10b981' : '#ef4444',
                      }}>
                        {trade.direction === 'BUY' ? '▲' : '▼'} {trade.symbol}
                      </span>
                      <span style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(167,139,250,0.15)',
                        color: '#a78bfa',
                      }}>
                        {trade.strategy}
                      </span>
                      <span style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: trade.status === 'REJECTED'
                          ? 'rgba(239,68,68,0.15)'
                          : trade.status === 'OPEN'
                          ? 'rgba(245,158,11,0.15)'
                          : 'rgba(16,185,129,0.15)',
                        color: trade.status === 'REJECTED' ? '#ef4444' : trade.status === 'OPEN' ? '#f59e0b' : '#10b981',
                      }}>
                        {trade.status}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {trade.qty} × ₹{trade.price}
                      </div>
                      {trade.pnl !== undefined && (
                        <div style={{ fontSize: 12, color: trade.pnl >= 0 ? '#10b981' : '#ef4444' }}>
                          {trade.pnl >= 0 ? '+' : ''}₹{trade.pnl.toFixed(2)} ({trade.pnlPct?.toFixed(2)}%)
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
                    {new Date(trade.entryTime).toLocaleString('en-IN')}
                    {trade.rejectionReason && <span style={{ color: '#ef4444', marginLeft: 8 }}>• {trade.rejectionReason}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
