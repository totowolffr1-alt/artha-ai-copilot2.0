/**
 * ManualTrade.tsx
 * Broker-grade manual order placement — search NSE stock → enter qty → BUY/SELL via Angel One
 */
import { useState, useEffect, useRef } from 'react';
import { getServerIp } from '../services/api';

const BASE = '/api';

// ── Popular stocks for quick-pick ─────────────────────────────────────────────
const POPULAR_STOCKS = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', ltp: 2880 },
  { symbol: 'TCS',      name: 'Tata Consultancy',   ltp: 3612 },
  { symbol: 'INFY',     name: 'Infosys',             ltp: 1590 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank',           ltp: 1332 },
  { symbol: 'SBIN',     name: 'State Bank of India', ltp: 821  },
  { symbol: 'CUPID',    name: 'Cupid Ltd',           ltp: 215  },
  { symbol: 'ZOMATO',   name: 'Zomato',              ltp: 264  },
  { symbol: 'ADANIENT', name: 'Adani Enterprises',   ltp: 2640 },
  { symbol: 'ICICIBANK',name: 'ICICI Bank',           ltp: 1288 },
  { symbol: 'BAJFINANCE',name:'Bajaj Finance',        ltp: 8940 },
];

type OrderType    = 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
type ProductType  = 'DELIVERY' | 'INTRADAY' | 'MTF';
type OrderStatus  = 'idle' | 'confirming' | 'placing' | 'success' | 'error';

interface SelectedStock {
  symbol: string;
  name: string;
  ltp: number;
}

// ── Brokerage estimator (Zerodha-style) ───────────────────────────────────────
function estimateBrokerage(qty: number, price: number, orderType: ProductType): {
  brokerage: number; stt: number; total: number;
} {
  const value    = qty * price;
  const brokerage = orderType === 'DELIVERY' ? 0 : Math.min(20, value * 0.0003);
  const stt       = orderType === 'DELIVERY' ? value * 0.001 : value * 0.00025;
  const other     = value * 0.0001; // exchange + SEBI fees
  return {
    brokerage: parseFloat(brokerage.toFixed(2)),
    stt:       parseFloat(stt.toFixed(2)),
    total:     parseFloat((brokerage + stt + other).toFixed(2)),
  };
}

export default function ManualTrade() {
  const [search, setSearch]       = useState('');
  const [results, setResults]     = useState<SelectedStock[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected]   = useState<SelectedStock | null>(null);

  const [side, setSide]           = useState<'BUY' | 'SELL'>('BUY');
  const [qty, setQty]             = useState('');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [productType, setProductType] = useState<ProductType>('DELIVERY');
  const [limitPrice, setLimitPrice]   = useState('');
  const [slTrigger, setSlTrigger]     = useState('');

  const [status, setStatus]       = useState<OrderStatus>('idle');
  const [orderResult, setOrderResult] = useState<any>(null);
  const [errorMsg, setErrorMsg]   = useState('');
  const [serverIp, setServerIp]   = useState('Fetching…');
  const [copied, setCopied]       = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch server IP on mount
  useEffect(() => {
    getServerIp().then(setServerIp);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Local fuzzy search against popular stocks list
  useEffect(() => {
    const q = search.trim().toUpperCase();
    if (!q) { setResults([]); setShowDropdown(false); return; }
    const filtered = POPULAR_STOCKS.filter(
      s => s.symbol.includes(q) || s.name.toUpperCase().includes(q)
    );
    setResults(filtered.length > 0 ? filtered : [{ symbol: q, name: `${q} (NSE)`, ltp: 0 }]);
    setShowDropdown(true);
  }, [search]);

  function selectStock(s: SelectedStock) {
    setSelected(s);
    setSearch('');
    setShowDropdown(false);
    setStatus('idle');
    setOrderResult(null);
  }

  const price     = selected ? (orderType === 'MARKET' ? selected.ltp : parseFloat(limitPrice) || selected.ltp) : 0;
  const qtyNum    = parseInt(qty) || 0;
  const orderValue = price * qtyNum;
  const brok      = qtyNum > 0 && price > 0 ? estimateBrokerage(qtyNum, price, productType) : null;

  async function handleConfirm() {
    if (!selected || !qtyNum) return;
    setStatus('placing');
    setErrorMsg('');
    try {
      const body: Record<string, any> = {
        symbol:       selected.symbol,
        direction:    side,
        qty:          qtyNum,
        order_type:   orderType,
        product_type: productType,
      };
      if (orderType === 'LIMIT' || orderType === 'SL') body.price = limitPrice;
      if (orderType === 'SL' || orderType === 'SL-M')  body.trigger_price = slTrigger;

      const res = await fetch(`${BASE}/trading/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setOrderResult(data);
      setStatus(data.success ? 'success' : 'error');
      if (!data.success) setErrorMsg(data.order?.reject_reason || data.error || 'Order rejected');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Network error');
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const CARD: React.CSSProperties = {
    background: 'linear-gradient(135deg,rgba(17,24,39,0.97) 0%,rgba(30,27,75,0.4) 100%)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
  };
  const INPUT: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(15,23,42,0.85)',
    color: '#fff',
    fontSize: 15,
    fontFamily: 'monospace',
    boxSizing: 'border-box',
  };
  const SEG_BTN = (active: boolean, color: string): React.CSSProperties => ({
    flex: 1,
    padding: '10px 0',
    borderRadius: 10,
    border: `1px solid ${active ? color : 'rgba(255,255,255,0.08)'}`,
    background: active ? `${color}22` : 'transparent',
    color: active ? color : 'var(--muted)',
    fontWeight: active ? 700 : 500,
    fontSize: 15,
    cursor: 'pointer',
    transition: 'all 0.18s',
  });
  const CHIP = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 8,
    border: `1px solid ${active ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
    background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
    color: active ? '#a5b4fc' : 'var(--muted)',
    fontWeight: active ? 600 : 400,
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  return (
    <div>
      <h2>Trade <span className="badge">ANGEL ONE</span></h2>
      <p style={{ color: 'var(--muted)', marginBottom: 24, fontSize: 14 }}>
        Search any NSE stock, set quantity &amp; order type, and place directly on your Angel One account.
      </p>

      {/* ── Stock Search ──────────────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e7ff', marginBottom: 12 }}>
          🔍 Search Stock (NSE)
        </div>

        {/* Popular quick-picks */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {POPULAR_STOCKS.slice(0, 7).map(s => (
            <button key={s.symbol} onClick={() => selectStock(s)} style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: selected?.symbol === s.symbol ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
              background: selected?.symbol === s.symbol ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
              color: selected?.symbol === s.symbol ? '#a5b4fc' : 'var(--muted)',
              cursor: 'pointer',
            }}>
              {s.symbol}
            </button>
          ))}
        </div>

        {/* Search input with dropdown */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <input
            id="stock-search"
            style={INPUT}
            placeholder="Type symbol e.g. NIFTY, HDFC, ZOMATO…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => search && setShowDropdown(true)}
            autoComplete="off"
          />
          {showDropdown && results.length > 0 && (
            <div style={{
              position: 'absolute', top: '110%', left: 0, right: 0, zIndex: 100,
              background: '#0f172a', border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 10, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}>
              {results.map(r => (
                <button key={r.symbol} onClick={() => selectStock(r)} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  width: '100%', padding: '10px 16px', background: 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)',
                  color: '#e0e7ff', cursor: 'pointer', textAlign: 'left',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <div>
                    <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 14 }}>{r.symbol}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 10 }}>{r.name}</span>
                  </div>
                  {r.ltp > 0 && <span style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: 13 }}>₹{r.ltp}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected stock display */}
        {selected && (
          <div style={{
            marginTop: 14, padding: '12px 16px', borderRadius: 12,
            background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
          }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, color: '#e0e7ff', fontFamily: 'monospace' }}>{selected.symbol}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{selected.name} · NSE</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#60a5fa', fontFamily: 'monospace' }}>₹{selected.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Last traded price</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Order Form (only shown when stock is selected) ─────────────────── */}
      {selected && (
        <>
          <div style={CARD}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e7ff', marginBottom: 16 }}>
              📋 Order Details
            </div>

            {/* BUY / SELL toggle */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <button id="btn-buy" style={SEG_BTN(side === 'BUY', '#34d399')} onClick={() => setSide('BUY')}>
                ▲ BUY
              </button>
              <button id="btn-sell" style={SEG_BTN(side === 'SELL', '#f87171')} onClick={() => setSide('SELL')}>
                ▼ SELL
              </button>
            </div>

            {/* Order Type chips */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Order Type</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['MARKET', 'LIMIT', 'SL', 'SL-M'] as OrderType[]).map(t => (
                  <button key={t} onClick={() => setOrderType(t)} style={CHIP(orderType === t)}>{t}</button>
                ))}
              </div>
            </div>

            {/* Product Type chips */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Product Type</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['DELIVERY', 'INTRADAY', 'MTF'] as ProductType[]).map(t => (
                  <button key={t} onClick={() => setProductType(t)} style={CHIP(productType === t)}>{t}</button>
                ))}
              </div>
            </div>

            {/* Quantity + Price inputs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Quantity (shares)</div>
                <input id="qty-input" type="number" min="1" placeholder="e.g. 10"
                  style={INPUT} value={qty} onChange={e => setQty(e.target.value)} />
              </div>

              {(orderType === 'LIMIT' || orderType === 'SL') && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Limit Price (₹)</div>
                  <input id="limit-price" type="number" min="0" step="0.05"
                    placeholder={`e.g. ${selected.ltp}`}
                    style={INPUT} value={limitPrice} onChange={e => setLimitPrice(e.target.value)} />
                </div>
              )}

              {(orderType === 'SL' || orderType === 'SL-M') && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Trigger Price (₹)</div>
                  <input id="sl-trigger" type="number" min="0" step="0.05"
                    placeholder="Stop-loss trigger"
                    style={INPUT} value={slTrigger} onChange={e => setSlTrigger(e.target.value)} />
                </div>
              )}
            </div>

            {/* Order Summary Box */}
            {qtyNum > 0 && (
              <div style={{
                padding: '14px 16px', borderRadius: 12, marginBottom: 20,
                background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 10 }}>ORDER SUMMARY</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
                  <span style={{ color: 'var(--muted)' }}>Side</span>
                  <span style={{ color: side === 'BUY' ? '#34d399' : '#f87171', fontWeight: 700 }}>{side}</span>
                  <span style={{ color: 'var(--muted)' }}>Quantity</span>
                  <span style={{ color: '#e0e7ff', fontFamily: 'monospace' }}>{qtyNum} shares</span>
                  <span style={{ color: 'var(--muted)' }}>Price</span>
                  <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>₹{price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  <span style={{ color: 'var(--muted)' }}>Order Value</span>
                  <span style={{ color: '#e0e7ff', fontFamily: 'monospace', fontWeight: 700 }}>₹{orderValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  {brok && (
                    <>
                      <span style={{ color: 'var(--muted)' }}>Est. Brokerage</span>
                      <span style={{ color: '#fbbf24', fontFamily: 'monospace' }}>₹{brok.brokerage} + STT ₹{brok.stt}</span>
                      <span style={{ color: 'var(--muted)' }}>Total Charges</span>
                      <span style={{ color: '#f87171', fontFamily: 'monospace' }}>₹{brok.total}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Place Order button */}
            {status !== 'success' && (
              <button
                id="place-order-btn"
                disabled={!qtyNum || status === 'placing'}
                onClick={() => setStatus('confirming')}
                style={{
                  width: '100%', padding: '14px 0', borderRadius: 12,
                  background: !qtyNum ? 'rgba(255,255,255,0.05)' : side === 'BUY' ? 'linear-gradient(90deg,#059669,#10b981)' : 'linear-gradient(90deg,#dc2626,#ef4444)',
                  border: 'none', color: '#fff', fontSize: 16, fontWeight: 700,
                  cursor: !qtyNum ? 'not-allowed' : 'pointer',
                  opacity: !qtyNum ? 0.5 : 1,
                  transition: 'all 0.2s',
                  boxShadow: !qtyNum ? 'none' : side === 'BUY' ? '0 4px 20px rgba(16,185,129,0.3)' : '0 4px 20px rgba(239,68,68,0.3)',
                }}>
                {status === 'placing' ? '⏳ Placing Order…' : `${side === 'BUY' ? '▲ BUY' : '▼ SELL'} ${selected?.symbol || ''}`}
              </button>
            )}
          </div>

          {/* ── Confirmation Dialog ──────────────────────────────────────── */}
          {status === 'confirming' && (
            <div style={{
              position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', padding: 16,
            }}>
              <div style={{
                background: '#0f172a', border: '1px solid rgba(99,102,241,0.4)',
                borderRadius: 18, padding: 28, maxWidth: 380, width: '100%',
                boxShadow: '0 16px 60px rgba(0,0,0,0.7)',
              }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
                  Confirm Order
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
                  This will place a real order on your Angel One account.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 14, marginBottom: 20 }}>
                  {[
                    ['Stock', selected.symbol],
                    ['Side', side],
                    ['Qty', `${qtyNum}`],
                    ['Type', `${orderType} / ${productType}`],
                    ['Value', `₹${orderValue.toLocaleString('en-IN')}`],
                    ['Charges', brok ? `~₹${brok.total}` : '—'],
                  ].map(([k, v]) => (
                    <>
                      <span key={`k-${k}`} style={{ color: 'var(--muted)' }}>{k}</span>
                      <span key={`v-${k}`} style={{
                        fontWeight: 700, fontFamily: 'monospace',
                        color: k === 'Side' ? (side === 'BUY' ? '#34d399' : '#f87171') : '#e0e7ff',
                      }}>{v}</span>
                    </>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setStatus('idle')} style={{
                    flex: 1, padding: '12px 0', borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
                    color: 'var(--muted)', cursor: 'pointer', fontSize: 14,
                  }}>Cancel</button>
                  <button id="confirm-order-btn" onClick={handleConfirm} style={{
                    flex: 2, padding: '12px 0', borderRadius: 10, border: 'none',
                    background: side === 'BUY' ? 'linear-gradient(90deg,#059669,#10b981)' : 'linear-gradient(90deg,#dc2626,#ef4444)',
                    color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14,
                    boxShadow: side === 'BUY' ? '0 4px 16px rgba(16,185,129,0.3)' : '0 4px 16px rgba(239,68,68,0.3)',
                  }}>
                    ✅ Confirm {side}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Order Result ──────────────────────────────────────────────── */}
          {status === 'success' && orderResult && (
            <div style={{
              ...CARD,
              background: 'rgba(16,185,129,0.06)',
              border: '1px solid rgba(16,185,129,0.3)',
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#34d399', marginBottom: 8 }}>
                ✅ Order Placed Successfully!
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13, marginBottom: 16 }}>
                <span style={{ color: 'var(--muted)' }}>Broker Order ID</span>
                <span style={{ fontFamily: 'monospace', color: '#e0e7ff' }}>{orderResult.order?.broker_order_id || '—'}</span>
                <span style={{ color: 'var(--muted)' }}>Status</span>
                <span style={{ fontFamily: 'monospace', color: '#34d399', fontWeight: 700 }}>{orderResult.order?.status}</span>
                {orderResult.simulated && (
                  <>
                    <span style={{ color: 'var(--muted)' }}>Mode</span>
                    <span style={{ color: '#fbbf24' }}>SIMULATED (broker offline)</span>
                  </>
                )}
              </div>
              <button onClick={() => { setStatus('idle'); setQty(''); setLimitPrice(''); setSlTrigger(''); }}
                style={{
                  padding: '10px 24px', borderRadius: 10,
                  background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
                  color: '#a5b4fc', fontWeight: 600, cursor: 'pointer', fontSize: 14,
                }}>
                Place Another Order
              </button>
            </div>
          )}

          {status === 'error' && (
            <div style={{
              ...CARD,
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.3)',
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#f87171', marginBottom: 6 }}>❌ Order Failed</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>{errorMsg}</div>

              {/* Server IP Whitelist Helper Card */}
              {errorMsg.toLowerCase().includes('not a registered ip') && (
                <div style={{
                  padding: '12px 14px', borderRadius: 10, marginBottom: 16,
                  background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>
                    ⚠️ Server IP Changed
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.4 }}>
                    Vercel/Railway changes server outbound IPs dynamically. You must add this current IP to your Angel One API whitelist:
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <code style={{ flex: 1, background: '#090d16', padding: '6px 10px', borderRadius: 6, fontSize: 12, color: '#e0e7ff', border: '1px solid rgba(255,255,255,0.06)', fontFamily: 'monospace' }}>
                      {serverIp}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(serverIp);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      style={{
                        padding: '6px 12px', borderRadius: 6, border: 'none',
                        background: copied ? '#059669' : '#4f46e5',
                        color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        transition: 'background 0.2s',
                      }}
                    >
                      {copied ? '✅ Copied' : '📋 Copy'}
                    </button>
                  </div>
                </div>
              )}

              <button onClick={() => setStatus('idle')} style={{
                padding: '8px 20px', borderRadius: 10,
                background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#f87171', cursor: 'pointer', fontSize: 13,
              }}>Try Again</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
