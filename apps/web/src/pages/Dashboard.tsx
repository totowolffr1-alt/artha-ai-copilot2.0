import { useEffect, useState } from 'react';
import { subscribeTicks, getWatchlist, Tick, subscribeSignals, Signal, placeOrder, getCopilotTrades } from '../services/api';
import { getMarketSession } from '../services/marketSession';
import { CapitalVaultCard } from '../components/CapitalVaultCard';
import { RiskDashboard } from '../components/RiskDashboard';
import { OrderBook } from '../components/OrderBook';

const INITIAL_SIGNALS: Signal[] = [
  {
    signal_id: 'sig-cupid-01',
    symbol: 'CUPID',
    direction: 'LONG',
    entry_price: 215.40,
    stop_loss: 202.00,
    target_price: 245.00,
    confidence: 0.88,
    strategy: 'VOLATILITY_BREAKOUT',
    timeframe: 'D',
    timestamp: new Date().toISOString(),
  },
  {
    signal_id: 'sig-rel-02',
    symbol: 'RELIANCE',
    direction: 'LONG',
    entry_price: 2880.00,
    stop_loss: 2820.00,
    target_price: 3020.00,
    confidence: 0.76,
    strategy: 'EMA_CROSSOVER',
    timeframe: '1h',
    timestamp: new Date().toISOString(),
  },
  {
    signal_id: 'sig-tcs-03',
    symbol: 'TCS',
    direction: 'LONG',
    entry_price: 3612.00,
    stop_loss: 3540.00,
    target_price: 3750.00,
    confidence: 0.72,
    strategy: 'SUPPORT_BOUNCE',
    timeframe: 'D',
    timestamp: new Date().toISOString(),
  },
];

export default function Dashboard() {
  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({});
  const [signals, setSignals] = useState<Signal[]>(INITIAL_SIGNALS);
  const [executingSignalId, setExecutingSignalId] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<Record<string, string>>({});
  
  const [regime] = useState('STRONG_BULL');
  const [vix] = useState(14.5);
  const [drawdown] = useState(-0.04);
  const [killSwitchActive] = useState(false);
  const [copilotData, setCopilotData] = useState<{ trades: any[]; summary: any }>({
    trades: [],
    summary: { totalPnL: 0, openTrades: 0, todayTrades: 0, winRate: 0 },
  });

  // Poll copilot trades every 5 seconds
  useEffect(() => {
    getCopilotTrades().then(setCopilotData);
    const id = setInterval(() => getCopilotTrades().then(setCopilotData), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Initial fetch of watchlist & closing prices
    getWatchlist()
      .then(items => {
        if (items && items.length > 0) {
          const initialMap: Record<string, Tick> = {};
          items.forEach((item: any) => {
            const sym = item.symbol || item.ticker;
            if (sym) {
              initialMap[sym] = {
                symbol: sym,
                exchange: item.exchange || 'NSE',
                price: item.price || item.last_price || 100,
                timestamp: new Date().toISOString(),
              };
            }
          });
          setTicks(initialMap);
        }
      })
      .catch(() => {});
    
    // Subscribe to ticks
    const unsubscribeTicks = subscribeTicks((tick: any) => {
      setTicks(prev => {
        // Only update prevPrices during live market hours to prevent off-hours flicker
        if (tick.marketOpen !== false) {
          const oldPrice = prev[tick.symbol]?.price ?? tick.price;
          setPrevPrices(p => ({ ...p, [tick.symbol]: oldPrice }));
        }
        return { ...prev, [tick.symbol]: tick };
      });
    });

    // Subscribe to strategy signals
    const unsubscribeSignals = subscribeSignals(sig => {
      setSignals(prev => {
        if (prev.some(s => s.signal_id === sig.signal_id)) return prev;
        return [sig, ...prev].slice(0, 10);
      });
    });

    return () => {
      unsubscribeTicks();
      unsubscribeSignals();
    };
  }, []);

  async function handleExecuteOrder(sig: Signal) {
    setExecutingSignalId(sig.signal_id);
    try {
      const res = await placeOrder({
        symbol: sig.symbol,
        direction: sig.direction === 'LONG' ? 'BUY' : 'SELL',
        qty: 10,
        order_type: 'LIMIT'
      });
      if (res.success) {
        setExecutionResult(prev => ({
          ...prev,
          [sig.signal_id]: `FILLED (Broker Order: ${res.order.broker_order_id})`
        }));
      } else {
        setExecutionResult(prev => ({
          ...prev,
          [sig.signal_id]: `REJECTED: ${res.order.reject_reason || 'Broker reject'}`
        }));
      }
    } catch (err: any) {
      setExecutionResult(prev => ({
        ...prev,
        [sig.signal_id]: `ERROR: ${err.message}`
      }));
    } finally {
      setExecutingSignalId(null);
    }
  }

  const rows = Object.values(ticks).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const session = getMarketSession();

  return (
    <div>
      {killSwitchActive && (
        <div className="alert-banner">
          <div className="alert-banner-content">
            <span style={{ fontSize: 20 }}>🔴</span>
            <div>
              <strong style={{ color: '#fff' }}>EMERGENCY STOP TRIGGERED</strong>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Risk limits breached. Trading engine disengaged.</div>
            </div>
          </div>
        </div>
      )}

      <h2>Dashboard <span className="badge">LIVE TERMINAL</span></h2>

      {/* Market Session Banner */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 18px', background: session.isOpen ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
        border: `1px solid ${session.isOpen ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
        borderRadius: 12, marginBottom: 24, flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: session.isOpen ? '#10b981' : '#ef4444',
            display: 'inline-block',
          }} />
          <strong style={{ color: session.isOpen ? '#34d399' : '#f87171', fontSize: 13 }}>{session.status}</strong>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{session.message}</span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>
          IST {new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
        </span>
      </div>

      {/* 🤖 Quant Employee — Capital Vault Allotment Widget */}
      <CapitalVaultCard />

      {/* 🤖 Copilot Activity — Live Trade Monitor */}
      <div className="card" style={{
        padding: 24,
        marginBottom: 24,
        background: 'linear-gradient(135deg, rgba(17,24,39,0.95) 0%, rgba(15,23,42,0.6) 100%)',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 16,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🤖 Copilot Activity</span>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981', animation: 'pulse 2s infinite' }} />
          </h3>
          <span style={{ fontSize: 11, color: 'var(--muted)', background: 'rgba(255,255,255,0.04)', padding: '4px 10px', borderRadius: 8 }}>Auto-refreshes every 5s</span>
        </div>

        {/* Summary Stats Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total P&L', value: `${copilotData.summary.totalPnL >= 0 ? '+' : ''}₹${copilotData.summary.totalPnL.toFixed(2)}`, color: copilotData.summary.totalPnL >= 0 ? '#34d399' : '#f87171' },
            { label: 'Open Trades', value: copilotData.summary.openTrades, color: '#60a5fa' },
            { label: "Today's Trades", value: copilotData.summary.todayTrades, color: '#a78bfa' },
            { label: 'Win Rate', value: `${copilotData.summary.winRate}%`, color: copilotData.summary.winRate >= 50 ? '#34d399' : '#f87171' },
          ].map(stat => (
            <div key={stat.label} style={{ background: 'rgba(255,255,255,0.03)', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{stat.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: stat.color, fontFamily: 'monospace' }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Trade Table */}
        {copilotData.trades.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 14 }}>
            No trades placed yet — Copilot is watching the market 👀
          </div>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Symbol', 'Side', 'Qty', 'Entry', 'Curr. Price', 'P&L', 'Status', 'Mode'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {copilotData.trades.map((t: any) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#e0e7ff', fontFamily: 'monospace' }}>{t.symbol}</td>
                    <td style={{ padding: '8px 10px', color: t.side === 'BUY' ? '#34d399' : '#f87171', fontWeight: 600 }}>{t.side}</td>
                    <td style={{ padding: '8px 10px', color: '#e0e7ff', fontFamily: 'monospace' }}>{t.qty}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--muted)', fontFamily: 'monospace' }}>₹{t.entryPrice.toFixed(2)}</td>
                    <td style={{ padding: '8px 10px', color: '#e0e7ff', fontFamily: 'monospace' }}>₹{t.currentPrice.toFixed(2)}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, fontFamily: 'monospace', color: t.pnl >= 0 ? '#34d399' : '#f87171' }}>
                      {t.pnl >= 0 ? '+' : ''}₹{t.pnl.toFixed(2)}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: t.status === 'OPEN' ? 'rgba(96,165,250,0.15)' : t.status === 'PENDING' ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.15)',
                        color: t.status === 'OPEN' ? '#60a5fa' : t.status === 'PENDING' ? '#fbbf24' : '#9ca3af',
                      }}>{t.status}</span>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: t.mode === 'LIVE' ? 'rgba(239,68,68,0.12)' : 'rgba(99,102,241,0.12)',
                        color: t.mode === 'LIVE' ? '#f87171' : '#818cf8',
                      }}>{t.mode}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 🛡️ Risk Dashboard */}
      <RiskDashboard />

      {/* Overview Stats */}
      <div className="grid">
        <div className="card stat-container">
          <div className="stat-label">Market Regime</div>
          <div className="stat-value" style={{ color: '#10b981' }}>{regime}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Bullish trend structure</div>
        </div>

        <div className="card stat-container">
          <div className="stat-label">India VIX</div>
          <div className="stat-value" style={{ color: '#a78bfa' }}>{vix.toFixed(2)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Normal volatility range</div>
        </div>

        <div className="card stat-container">
          <div className="stat-label">Portfolio Drawdown</div>
          <div className="stat-value" style={{ color: '#34d399' }}>{(drawdown * 100).toFixed(1)}%</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Within max 5% limit</div>
        </div>
      </div>

      {/* Live Signals & Ticks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Live Strategy Signals */}
        <div className="card">
          <h3 style={{ fontSize: 16, color: '#fff', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⚡ Strategy Signals</span>
            <span className="badge">{signals.length} Active</span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {signals.map(sig => (
              <div key={sig.signal_id} style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border)',
                borderRadius: 10, padding: 14,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#fff', marginRight: 8 }}>{sig.symbol}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{sig.strategy}</span>
                  </div>
                  <span className={`badge ${sig.direction === 'LONG' ? 'success' : 'danger'}`}>
                    {sig.direction}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                  <div>Entry: <strong style={{ color: '#fff' }}>₹{sig.entry_price}</strong></div>
                  <div>Stop: <strong style={{ color: '#ef4444' }}>₹{sig.stop_loss}</strong></div>
                  <div>Target: <strong style={{ color: '#10b981' }}>₹{sig.target_price}</strong></div>
                  <div>Confidence: <strong style={{ color: '#a78bfa' }}>{(sig.confidence * 100).toFixed(0)}%</strong></div>
                </div>
                {executionResult[sig.signal_id] ? (
                  <div style={{ fontSize: 12, fontWeight: 600, color: executionResult[sig.signal_id].startsWith('FILLED') ? '#10b981' : '#ef4444' }}>
                    {executionResult[sig.signal_id]}
                  </div>
                ) : (
                  <button
                    onClick={() => handleExecuteOrder(sig)}
                    disabled={executingSignalId === sig.signal_id}
                    style={{ width: '100%', padding: '8px 0', fontSize: 12 }}
                  >
                    {executingSignalId === sig.signal_id ? 'Executing Order…' : '⚡ Execute Trade'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Live Watchlist Ticks */}
        <div className="card">
          <h3 style={{ fontSize: 16, color: '#fff', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📊 Watchlist Ticks</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{session.isOpen ? 'Live' : 'Last Closing Prices'}</span>
          </h3>
          {rows.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 0', fontSize: 13 }}>
              Loading watchlist prices…
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th style={{ textAlign: 'right' }}>LTP</th>
                  <th style={{ textAlign: 'right' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                  {rows.map(tick => {
                    const prev  = prevPrices[tick.symbol] ?? tick.price;
                    const isOpen = session.isOpen;
                    // Only show price direction colour when market is live
                    const priceClass = !isOpen ? '' : tick.price > prev ? 'price-up' : tick.price < prev ? 'price-down' : '';
                    return (
                      <tr key={tick.symbol}>
                        <td><strong>{tick.symbol}</strong></td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }} className={priceClass}>
                          ₹{tick.price.toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 11, color: isOpen ? '#10b981' : 'var(--muted)', fontFamily: 'monospace' }}>
                          {isOpen ? '🟢 LIVE' : 'CLOSE'}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 📋 Order Book */}
      <OrderBook />

    </div>
  );
}
