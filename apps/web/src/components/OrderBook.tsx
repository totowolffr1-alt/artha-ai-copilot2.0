/**
 * OrderBook.tsx
 * Today's orders with status badges + cancel button.
 */
import { useState, useEffect } from 'react';

const BASE = '/api';

interface Order {
  order_request_id: string;
  symbol: string;
  direction: string;
  qty: number;
  price: number | null;
  order_type: string;
  product_type: string;
  broker_order_id: string;
  status: 'OPEN' | 'REJECTED' | 'SIMULATED' | 'CANCELLED' | string;
  reject_reason: string | null;
  executed_at: string;
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  OPEN:      { bg: 'rgba(96,165,250,0.15)',   color: '#60a5fa' },
  COMPLETE:  { bg: 'rgba(16,185,129,0.12)',   color: '#34d399' },
  SIMULATED: { bg: 'rgba(245,158,11,0.12)',   color: '#fbbf24' },
  REJECTED:  { bg: 'rgba(239,68,68,0.12)',    color: '#f87171' },
  CANCELLED: { bg: 'rgba(107,114,128,0.12)',  color: '#9ca3af' },
};

function statusStyle(s: string) {
  return STATUS_STYLE[s] ?? { bg: 'rgba(107,114,128,0.1)', color: '#9ca3af' };
}

export function OrderBook() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('—');

  const fetchOrders = async () => {
    try {
      const res = await fetch(`${BASE}/trading/orders`);
      const data = await res.json();
      if (Array.isArray(data.orders)) {
        setOrders(data.orders.slice().reverse()); // newest first
        setLastUpdated(new Date().toLocaleTimeString('en-IN'));
      }
    } catch {}
  };

  useEffect(() => {
    fetchOrders();
    const id = setInterval(fetchOrders, 8000);
    return () => clearInterval(id);
  }, []);

  async function handleCancel(orderId: string, brokerOrderId: string) {
    setCancelling(orderId);
    try {
      // Optimistically update UI
      setOrders(prev => prev.map(o =>
        o.order_request_id === orderId ? { ...o, status: 'CANCELLED' } : o
      ));
      // Backend cancel (placeholder — Angel One cancel API)
      await fetch(`${BASE}/trading/orders/${orderId}/cancel`, { method: 'POST' })
        .catch(() => {}); // graceful fallback
    } finally {
      setCancelling(null);
    }
  }

  const TABLE_HEADER: React.CSSProperties = {
    padding: '8px 10px', textAlign: 'left', color: 'var(--muted)',
    fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  };
  const TD: React.CSSProperties = {
    padding: '9px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 13,
  };

  return (
    <div className="card" style={{
      padding: 24, marginBottom: 24,
      background: 'linear-gradient(135deg,rgba(17,24,39,0.97) 0%,rgba(15,23,42,0.5) 100%)',
      border: '1px solid rgba(99,102,241,0.18)', borderRadius: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#fff' }}>
          📋 Order Book <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>— Today</span>
        </h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', background: 'rgba(255,255,255,0.04)', padding: '4px 10px', borderRadius: 8 }}>
            Updated {lastUpdated}
          </span>
          <button onClick={fetchOrders} style={{
            padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.08)',
            color: '#a5b4fc', cursor: 'pointer',
          }}>↻ Refresh</button>
        </div>
      </div>

      {orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--muted)', fontSize: 14 }}>
          No orders placed today — use the ⚡ Trade tab to place an order
        </div>
      ) : (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 580 }}>
            <thead>
              <tr>
                {['Symbol', 'Side', 'Qty', 'Price', 'Type', 'Broker ID', 'Status', 'Time', 'Action'].map(h => (
                  <th key={h} style={TABLE_HEADER}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const ss = statusStyle(o.status);
                const canCancel = o.status === 'OPEN';
                return (
                  <tr key={o.order_request_id}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ ...TD, fontWeight: 700, color: '#e0e7ff', fontFamily: 'monospace' }}>{o.symbol}</td>
                    <td style={{ ...TD, color: o.direction === 'BUY' ? '#34d399' : '#f87171', fontWeight: 600 }}>{o.direction}</td>
                    <td style={{ ...TD, fontFamily: 'monospace', color: '#e0e7ff' }}>{o.qty}</td>
                    <td style={{ ...TD, fontFamily: 'monospace', color: 'var(--muted)' }}>
                      {o.price != null ? `₹${o.price.toFixed(2)}` : 'MKT'}
                    </td>
                    <td style={{ ...TD, color: 'var(--muted)', fontSize: 11 }}>{o.order_type} / {o.product_type}</td>
                    <td style={{ ...TD, fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.broker_order_id}
                    </td>
                    <td style={TD}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: ss.bg, color: ss.color,
                      }}>
                        {o.status}
                      </span>
                      {o.reject_reason && (
                        <div style={{ fontSize: 10, color: '#f87171', marginTop: 2 }}>{o.reject_reason}</div>
                      )}
                    </td>
                    <td style={{ ...TD, fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {new Date(o.executed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={TD}>
                      {canCancel ? (
                        <button
                          onClick={() => handleCancel(o.order_request_id, o.broker_order_id)}
                          disabled={cancelling === o.order_request_id}
                          style={{
                            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)',
                            color: '#f87171', cursor: 'pointer',
                          }}>
                          {cancelling === o.order_request_id ? '…' : '✕ Cancel'}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary footer */}
      {orders.length > 0 && (
        <div style={{ marginTop: 14, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
          <span>Total orders: <strong style={{ color: '#e0e7ff' }}>{orders.length}</strong></span>
          <span>Open: <strong style={{ color: '#60a5fa' }}>{orders.filter(o => o.status === 'OPEN').length}</strong></span>
          <span>Simulated: <strong style={{ color: '#fbbf24' }}>{orders.filter(o => o.status === 'SIMULATED').length}</strong></span>
          <span>Rejected: <strong style={{ color: '#f87171' }}>{orders.filter(o => o.status === 'REJECTED').length}</strong></span>
        </div>
      )}
    </div>
  );
}
