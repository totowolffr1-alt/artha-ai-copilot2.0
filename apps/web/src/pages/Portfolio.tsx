import { useState, useEffect } from 'react';
import MarketSessionBanner from '../components/MarketSessionBanner';
import { getPositions, getPaperTrades } from '../services/api';

const BASE = '/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Holding {
  symbol: string;
  qty: number;
  avgPrice: number;
  ltp: number;
  pnl: number;
  pnlPct: number;
  currentValue: number;
  exchange?: string;
}

interface Position {
  symbol: string;
  product: string;
  qty: number;
  avgPrice: number;
  ltp: number;
  unrealizedPnl: number;
  side: 'BUY' | 'SELL';
  exchange?: string;
}

interface PaperTrade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  entryPrice: number;
  exitPrice: number | null;
  netPnl: number;
  rMultiple: number | null;
  status: 'OPEN' | 'CLOSED';
  strategy: string;
  openedAt: string;
  closedAt?: string;
}

type Tab = 'holdings' | 'positions' | 'paper';

// ── Helpers ───────────────────────────────────────────────────────────────────
const pnlColor = (v: number) => (v >= 0 ? '#34d399' : '#f87171');
const fmtRs = (v: number) =>
  `${v >= 0 ? '+' : ''}₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const TAB_BTN = (active: boolean): React.CSSProperties => ({
  padding: '8px 20px',
  borderRadius: 10,
  border: `1px solid ${active ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.08)'}`,
  background: active ? 'rgba(99,102,241,0.18)' : 'transparent',
  color: active ? '#a5b4fc' : 'var(--muted)',
  fontWeight: active ? 700 : 500,
  fontSize: 14,
  cursor: 'pointer',
  transition: 'all 0.2s',
  whiteSpace: 'nowrap' as const,
});

const TABLE_HEADER: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  color: 'var(--muted)',
  fontWeight: 600,
  fontSize: 12,
  whiteSpace: 'nowrap',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const TABLE_CELL: React.CSSProperties = {
  padding: '10px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  fontSize: 13,
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function Portfolio() {
  const [tab, setTab] = useState<Tab>('holdings');

  // Holdings tab state
  const [holdingsData, setHoldingsData] = useState<{
    holdings: Holding[];
    totalValue: number;
    overallPnl: number;
    availableFunds: number;
    connected: boolean;
    broker: string | null;
    error?: string;
  }>({ holdings: [], totalValue: 0, overallPnl: 0, availableFunds: 0, connected: false, broker: null });
  const [holdingsLoading, setHoldingsLoading] = useState(true);

  // Positions tab state
  const [positionsData, setPositionsData] = useState<{
    positions: Position[];
    unrealizedPnl: number;
    isMarketCloseSoon: boolean;
    error?: string;
  }>({ positions: [], unrealizedPnl: 0, isMarketCloseSoon: false });

  // Paper tab state
  const [paperData, setPaperData] = useState<{
    trades: PaperTrade[];
    summary: { winRate: number; totalPnL: number; totalTrades: number; avgRMultiple: number; sharpe?: number };
  }>({ trades: [], summary: { winRate: 0, totalPnL: 0, totalTrades: 0, avgRMultiple: 0 } });

  // Fetch all data on mount + tab change
  useEffect(() => {
    setHoldingsLoading(true);
    fetch(`${BASE}/portfolio`)
      .then(r => r.json())
      .then(setHoldingsData)
      .catch(() => {})
      .finally(() => setHoldingsLoading(false));

    getPositions().then(setPositionsData);
    getPaperTrades().then(setPaperData);
  }, []);

  // Refresh positions/paper every 10s
  useEffect(() => {
    const id = setInterval(() => {
      getPositions().then(setPositionsData);
      getPaperTrades().then(setPaperData);
    }, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <MarketSessionBanner />
      <h2>Portfolio <span className="badge">DUAL-MODE</span></h2>

      {/* ── Tab Switcher ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <button id="tab-holdings" style={TAB_BTN(tab === 'holdings')} onClick={() => setTab('holdings')}>
          📦 Angel One Holdings
        </button>
        <button id="tab-positions" style={TAB_BTN(tab === 'positions')} onClick={() => setTab('positions')}>
          ⚡ Intraday / F&amp;O
        </button>
        <button id="tab-paper" style={TAB_BTN(tab === 'paper')} onClick={() => setTab('paper')}>
          🧪 Paper Trading
        </button>
      </div>

      {/* ── TAB 1: Holdings ────────────────────────────────────────────────── */}
      {tab === 'holdings' && (
        <div>
          {holdingsLoading ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
              Loading holdings from Angel One…
            </div>
          ) : (
            <>
              {/* Summary Banner */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 14, marginBottom: 20,
              }}>
                {[
                  { label: 'Total Value', value: `₹${(holdingsData.totalValue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, color: '#60a5fa' },
                  { label: 'Overall P&L', value: fmtRs(holdingsData.overallPnl || 0), color: pnlColor(holdingsData.overallPnl || 0) },
                  { label: 'Available Funds', value: `₹${(holdingsData.availableFunds || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, color: '#34d399' },
                  { label: 'Holdings', value: holdingsData.holdings.length, color: '#a78bfa' },
                ].map(s => (
                  <div key={s.label} className="card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {holdingsData.error && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: 13, marginBottom: 16 }}>
                  ⚠️ {holdingsData.error}
                </div>
              )}

              {/* Holdings Table */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 550 }}>
                    <thead>
                      <tr>
                        {['Symbol', 'Exchange', 'Qty', 'Avg Buy', 'LTP', 'Current Value', 'P&L', 'P&L %'].map(h => (
                          <th key={h} style={TABLE_HEADER}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {holdingsData.holdings.length === 0 ? (
                        <tr><td colSpan={8} style={{ ...TABLE_CELL, textAlign: 'center', color: 'var(--muted)', padding: 32 }}>No holdings found</td></tr>
                      ) : holdingsData.holdings.map(h => (
                        <tr key={h.symbol}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <td style={{ ...TABLE_CELL, fontWeight: 700, color: '#e0e7ff', fontFamily: 'monospace' }}>{h.symbol}</td>
                          <td style={{ ...TABLE_CELL, color: 'var(--muted)', fontSize: 11 }}>{h.exchange || 'NSE'}</td>
                          <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: '#e0e7ff' }}>{h.qty}</td>
                          <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: 'var(--muted)' }}>₹{(h.avgPrice || 0).toFixed(2)}</td>
                          <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: '#e0e7ff' }}>₹{(h.ltp || 0).toFixed(2)}</td>
                          <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: '#60a5fa' }}>₹{(h.currentValue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td style={{ ...TABLE_CELL, fontFamily: 'monospace', fontWeight: 700, color: pnlColor(h.pnl || 0) }}>{fmtRs(h.pnl || 0)}</td>
                          <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: pnlColor(h.pnlPct || 0) }}>{(h.pnlPct || 0) >= 0 ? '+' : ''}{(h.pnlPct || 0).toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── TAB 2: Positions ────────────────────────────────────────────────── */}
      {tab === 'positions' && (
        <div>
          {/* Market close warning */}
          {positionsData.isMarketCloseSoon && (
            <div style={{
              padding: '12px 16px', borderRadius: 10, marginBottom: 16,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
              color: '#f87171', fontSize: 14, fontWeight: 600,
            }}>
              ⚠️ Market closes in &lt;30 mins. Square off open positions to avoid auto-exit charges!
            </div>
          )}

          {/* Unrealized P&L banner */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 14, marginBottom: 20,
          }}>
            {[
              { label: 'Unrealized P&L', value: fmtRs(positionsData.unrealizedPnl), color: pnlColor(positionsData.unrealizedPnl) },
              { label: 'Open Positions', value: positionsData.positions.length, color: '#60a5fa' },
            ].map(s => (
              <div key={s.label} className="card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
                <thead>
                  <tr>
                    {['Symbol', 'Exchange', 'Product', 'Side', 'Qty', 'Avg Price', 'LTP', 'Unrealized P&L'].map(h => (
                      <th key={h} style={TABLE_HEADER}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positionsData.positions.length === 0 ? (
                    <tr><td colSpan={8} style={{ ...TABLE_CELL, textAlign: 'center', padding: 36 }}>
                      <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 8 }}>No open intraday / F&amp;O positions</div>
                      {(positionsData as any).error && (
                        <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(239,68,68,0.08)', padding: '6px 12px', borderRadius: 8, display: 'inline-block' }}>
                          ⚠️ {(positionsData as any).error}
                        </div>
                      )}
                    </td></tr>
                  ) : positionsData.positions.map((p, i) => (
                    <tr key={i}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...TABLE_CELL, fontWeight: 700, color: '#e0e7ff', fontFamily: 'monospace' }}>{p.symbol}</td>
                      <td style={{ ...TABLE_CELL, color: 'var(--muted)', fontSize: 11 }}>{p.exchange || 'NSE'}</td>
                      <td style={{ ...TABLE_CELL, color: 'var(--muted)', fontSize: 11 }}>{p.product}</td>
                      <td style={{ ...TABLE_CELL, color: p.side === 'BUY' ? '#34d399' : '#f87171', fontWeight: 600 }}>{p.side}</td>
                      <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: '#e0e7ff' }}>{p.qty}</td>
                      <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: 'var(--muted)' }}>₹{(p.avgPrice || 0).toFixed(2)}</td>
                      <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: '#e0e7ff' }}>₹{(p.ltp || 0).toFixed(2)}</td>
                      <td style={{ ...TABLE_CELL, fontFamily: 'monospace', fontWeight: 700, color: pnlColor(p.unrealizedPnl) }}>{fmtRs(p.unrealizedPnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: Paper Trading ────────────────────────────────────────────── */}
      {tab === 'paper' && (
        <div>
          {/* Stats grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 14, marginBottom: 20,
          }}>
            {[
              { label: 'Win Rate',     value: `${paperData.summary.winRate}%`,         color: paperData.summary.winRate >= 50 ? '#34d399' : '#f87171' },
              { label: 'Total P&L',    value: fmtRs(paperData.summary.totalPnL),       color: pnlColor(paperData.summary.totalPnL) },
              { label: 'Total Trades', value: paperData.summary.totalTrades,            color: '#a78bfa' },
              { label: 'Avg R-Multiple', value: `${paperData.summary.avgRMultiple}R`,   color: paperData.summary.avgRMultiple >= 1 ? '#34d399' : '#fbbf24' },
            ].map(s => (
              <div key={s.label} className="card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                <thead>
                  <tr>
                    {['Symbol', 'Side', 'Qty', 'Entry', 'Exit', 'Net P&L', 'R-Mul', 'Status', 'Strategy'].map(h => (
                      <th key={h} style={TABLE_HEADER}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paperData.trades.length === 0 ? (
                    <tr><td colSpan={9} style={{ ...TABLE_CELL, textAlign: 'center', padding: 36 }}>
                      <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 6 }}>🧪 No paper trades yet</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Trades will appear here once the copilot executes paper orders</div>
                    </td></tr>
                  ) : paperData.trades.map(t => (
                    <tr key={t.id}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...TABLE_CELL, fontWeight: 700, color: '#e0e7ff', fontFamily: 'monospace' }}>{t.symbol}</td>
                      <td style={{ ...TABLE_CELL, color: t.side === 'BUY' ? '#34d399' : '#f87171', fontWeight: 600 }}>{t.side}</td>
                      <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: '#e0e7ff' }}>{t.qty}</td>
                      <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: 'var(--muted)' }}>₹{t.entryPrice.toFixed(2)}</td>
                      <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: 'var(--muted)' }}>{t.exitPrice != null ? `₹${t.exitPrice.toFixed(2)}` : '—'}</td>
                      <td style={{ ...TABLE_CELL, fontFamily: 'monospace', fontWeight: 700, color: pnlColor(t.netPnl) }}>{fmtRs(t.netPnl)}</td>
                      <td style={{ ...TABLE_CELL, fontFamily: 'monospace', color: (t.rMultiple ?? 0) >= 1 ? '#34d399' : (t.rMultiple ?? 0) >= 0 ? '#fbbf24' : '#f87171' }}>
                        {t.rMultiple != null ? `${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple}R` : '—'}
                      </td>
                      <td style={{ ...TABLE_CELL }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                          background: t.status === 'OPEN' ? 'rgba(96,165,250,0.15)' : 'rgba(107,114,128,0.12)',
                          color: t.status === 'OPEN' ? '#60a5fa' : '#9ca3af',
                        }}>{t.status}</span>
                      </td>
                      <td style={{ ...TABLE_CELL, color: 'var(--muted)', fontSize: 11 }}>{t.strategy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
