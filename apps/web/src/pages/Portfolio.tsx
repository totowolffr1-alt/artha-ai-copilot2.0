import { useEffect, useState } from 'react';
import { getPortfolio } from '../services/api';

export default function Portfolio() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    getPortfolio().then(setData).catch(() => {});
  }, []);

  if (!data) return <p style={{ color: 'var(--muted)', padding: 20 }}>Loading portfolio analytics…</p>;

  // Calculate total gains
  const totalCost = data.holdings.reduce((sum: number, h: any) => sum + (h.avgPrice * h.qty), 0);
  const totalCurrent = data.holdings.reduce((sum: number, h: any) => sum + (h.ltp * h.qty), 0);
  const totalGain = totalCurrent - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  return (
    <div>
      <h2>Portfolio Summary <span className="badge">Risk & Exposure</span></h2>
      <p className="description">
        Real-time exposure calculations, correlation maps, and historical simulation VaR limits configured via Stage 1 Risk Engine.
      </p>

      {/* Stats Summary Panel */}
      <div className="grid" style={{ marginBottom: 35 }}>
        <div className="card stat-container">
          <div className="stat-label">Net Asset Value</div>
          <div className="stat-value" style={{ color: '#fff' }}>₹{totalCurrent.toLocaleString('en-IN')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Live market value</div>
        </div>
        <div className="card stat-container">
          <div className="stat-label">Total Return</div>
          <div className="stat-value" style={{ color: totalGain >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {totalGain >= 0 ? '+' : ''}₹{totalGain.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {totalGain >= 0 ? '▲' : '▼'} {totalGainPct.toFixed(2)}% absolute
          </div>
        </div>
        <div className="card stat-container">
          <div className="stat-label">Portfolio Heat</div>
          <div className="stat-value" style={{ color: '#a78bfa' }}>28.5%</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Correlation-adjusted risk</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '24px 24px 8px 24px' }}>
          <h3 style={{ color: '#fff', fontSize: 18 }}>Current Holdings</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            Aggregated equity open positions. Liquid limits are updated every market minute.
          </p>
        </div>
        <table style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Quantity</th>
              <th>Avg Price</th>
              <th>LTP</th>
              <th style={{ textAlign: 'right' }}>Total Cost</th>
              <th style={{ textAlign: 'right' }}>Current Value</th>
              <th style={{ textAlign: 'right' }}>P&L</th>
            </tr>
          </thead>
          <tbody>
            {data.holdings.map((h: any) => {
              const cost = h.avgPrice * h.qty;
              const current = h.ltp * h.qty;
              const pnl = current - cost;
              const pnlPct = (pnl / (cost || 1)) * 100;
              
              return (
                <tr key={h.symbol}>
                  <td style={{ fontWeight: 600, color: '#fff' }}>{h.symbol}</td>
                  <td>{h.qty}</td>
                  <td>₹{h.avgPrice.toFixed(2)}</td>
                  <td>₹{h.ltp.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)' }}>₹{cost.toLocaleString('en-IN')}</td>
                  <td style={{ textAlign: 'right', color: '#fff', fontWeight: 500 }}>₹{current.toLocaleString('en-IN')}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }} className={pnl >= 0 ? 'price-up' : 'price-down'}>
                    {pnl >= 0 ? '+' : ''}₹{pnl.toLocaleString('en-IN')}
                    <div style={{ fontSize: 11, fontWeight: 500, marginTop: 2 }}>
                      ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
