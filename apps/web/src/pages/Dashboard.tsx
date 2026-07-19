import { useEffect, useState } from 'react';
import { subscribeTicks, getWatchlist, Tick, subscribeSignals, Signal, placeOrder } from '../services/api';

export default function Dashboard() {
  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({});
  const [signals, setSignals] = useState<Signal[]>([]);
  const [executingSignalId, setExecutingSignalId] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<Record<string, string>>({});
  
  const [regime, setRegime] = useState('STRONG_BULL');
  const [vix, setVix] = useState(14.5);
  const [drawdown, setDrawdown] = useState(-0.04);
  const [killSwitchActive, setKillSwitchActive] = useState(false);

  useEffect(() => {
    getWatchlist().catch(() => {});
    
    // Subscribe to live ticks
    const unsubscribeTicks = subscribeTicks(tick => {
      setPrevPrices(prev => ({ ...prev, [tick.symbol]: ticks[tick.symbol]?.price ?? tick.price }));
      setTicks(prev => ({ ...prev, [tick.symbol]: tick }));
    });

    // Subscribe to live strategy signals from Phase 5 Engine
    const unsubscribeSignals = subscribeSignals(sig => {
      setSignals(prev => {
        // Prevent duplicate signals by ID
        if (prev.some(s => s.signal_id === sig.signal_id)) return prev;
        return [sig, ...prev].slice(0, 10); // keep last 10
      });
    });

    return () => {
      unsubscribeTicks();
      unsubscribeSignals();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleExecuteOrder(sig: Signal) {
    setExecutingSignalId(sig.signal_id);
    try {
      const res = await placeOrder({
        symbol: sig.symbol,
        direction: sig.direction === 'LONG' ? 'BUY' : 'SELL',
        qty: 10, // Default trade size
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

  return (
    <div>
      {killSwitchActive && (
        <div className="alert-banner">
          <div className="alert-banner-content">
            <span style={{ fontSize: 20 }}>🔴</span>
            <div>
              <strong style={{ color: '#fff' }}>EMERGENCY STOP TRIGGERED</strong>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                KillSwitch is ACTIVE. New submissions are temporarily frozen due to safety checks.
              </div>
            </div>
          </div>
          <button className="secondary" onClick={() => setKillSwitchActive(false)} style={{ padding: '6px 12px', fontSize: 12 }}>
            Acknowledge
          </button>
        </div>
      )}

      <h2>Live Market Dashboard <span className="badge">LIVE FEED</span></h2>
      <p className="description">
        Streaming real-time pricing indicators from the mock data adapter. Fuses risk layers, safety sentinels, and capital protection calculations instantly.
      </p>

      {/* Top Overview Cards */}
      <div className="grid" style={{ marginBottom: 35 }}>
        <div className="card stat-container">
          <div className="stat-label">Market Regime</div>
          <div className="stat-value" style={{ color: '#a78bfa' }}>{regime}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Stage 0 Classifier active</div>
        </div>
        <div className="card stat-container">
          <div className="stat-label">India VIX</div>
          <div className="stat-value" style={{ color: vix > 20 ? 'var(--red)' : 'var(--green)' }}>
            {vix.toFixed(1)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Volatility Index</div>
        </div>
        <div className="card stat-container">
          <div className="stat-label">Max Drawdown</div>
          <div className="stat-value" style={{ color: drawdown < -0.08 ? 'var(--red)' : 'var(--green)' }}>
            {(drawdown * 100).toFixed(2)}%
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>From High Water Mark</div>
        </div>
      </div>

      {/* Live Strategy Signals Section */}
      <h3 style={{ color: '#fff', fontSize: 18, marginBottom: 16 }}>Live Strategy Signals (Phase 5 Engine)</h3>
      <div className="grid" style={{ marginBottom: 35 }}>
        {signals.length === 0 && (
          <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '30px 0', color: 'var(--muted)' }}>
            Waiting for Signal Engine trigger events... (Updates every 15 seconds)
          </div>
        )}
        {signals.map(sig => {
          const isLong = sig.direction === 'LONG';
          const orderStatus = executionResult[sig.signal_id];
          return (
            <div className="card" key={sig.signal_id} style={{ borderLeft: isLong ? '4px solid var(--green)' : '4px solid var(--red)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{sig.symbol}</span>
                <span className={`badge ${isLong ? 'success' : 'danger'}`}>
                  {sig.direction} {sig.confidence}% CONF
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 15 }}>
                <span>Entry LTP: <strong>₹{sig.entry_price.toFixed(2)}</strong></span>
                <span>Stop Loss: <strong>₹{sig.stop_loss.toFixed(2)}</strong></span>
                <span>Take Profit: <strong>₹{sig.take_profit.toFixed(2)}</strong></span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {new Date(sig.emitted_at).toLocaleTimeString()}
                </span>
                
                {orderStatus ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: orderStatus.startsWith('FILLED') ? 'var(--green)' : 'var(--red)' }}>
                    {orderStatus}
                  </span>
                ) : (
                  <button 
                    onClick={() => handleExecuteOrder(sig)}
                    disabled={executingSignalId === sig.signal_id}
                    style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6 }}
                  >
                    {executingSignalId === sig.signal_id ? 'Placing...' : 'Submit Order'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <h3 style={{ color: '#fff', fontSize: 18, marginBottom: 16 }}>Live Tick Streaming</h3>
      <div className="grid">
        {rows.length === 0 && <div className="card">Waiting for first tick…</div>}
        {rows.map(tick => {
          const prev = prevPrices[tick.symbol] ?? tick.price;
          const up = tick.price >= prev;
          const percentChange = ((tick.price - prev) / (prev || 1)) * 100;
          
          return (
            <div className="card" key={tick.symbol} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>
                  {tick.symbol}
                </span>
                <span className="badge">{tick.exchange}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px' }} className={up ? 'price-up' : 'price-down'}>
                  ₹{tick.price.toFixed(2)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600 }} className={up ? 'price-up' : 'price-down'}>
                  {up ? '▲' : '▼'} {Math.abs(percentChange).toFixed(2)}%
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Last updated</span>
                <span>{new Date(tick.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
