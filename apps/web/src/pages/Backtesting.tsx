import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface SimulationData {
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  drawdown: number;
  tradesCount: number;
  equityCurve: Array<{ day: number; equity: number }>;
}

const SAMPLE_REPORTS: Record<string, SimulationData> = {
  'MACD_CROSSOVER': {
    wins: 48, losses: 22, winRate: 68.5, profitFactor: 1.95, drawdown: -4.2, tradesCount: 70,
    equityCurve: [
      { day: 1, equity: 10000 }, { day: 5, equity: 10200 }, { day: 10, equity: 10150 },
      { day: 15, equity: 10600 }, { day: 20, equity: 10480 }, { day: 25, equity: 11100 },
      { day: 30, equity: 11450 }
    ]
  },
  'RSI_MEAN_REVERSION': {
    wins: 72, losses: 38, winRate: 65.4, profitFactor: 1.74, drawdown: -5.8, tradesCount: 110,
    equityCurve: [
      { day: 1, equity: 10000 }, { day: 5, equity: 9800 }, { day: 10, equity: 10300 },
      { day: 15, equity: 10100 }, { day: 20, equity: 10750 }, { day: 25, equity: 11200 },
      { day: 30, equity: 11820 }
    ]
  },
  'VOLATILITY_SQUEEZE': {
    wins: 30, losses: 12, winRate: 71.4, profitFactor: 2.15, drawdown: -3.8, tradesCount: 42,
    equityCurve: [
      { day: 1, equity: 10000 }, { day: 5, equity: 10400 }, { day: 10, equity: 10800 },
      { day: 15, equity: 10650 }, { day: 20, equity: 11200 }, { day: 25, equity: 11700 },
      { day: 30, equity: 12450 }
    ]
  }
};

export default function Backtesting() {
  const [strategy, setStrategy] = useState('VOLATILITY_SQUEEZE');
  const [timeframe, setTimeframe] = useState('30D');
  const [universe, setUniverse] = useState('SMALLCAP_100');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SimulationData | null>(null);

  function runSimulation() {
    setLoading(true);
    setReport(null);
    setTimeout(() => {
      setReport(SAMPLE_REPORTS[strategy] || SAMPLE_REPORTS.VOLATILITY_SQUEEZE);
      setLoading(false);
    }, 1200);
  }

  return (
    <div>
      <h2>Backtesting Sandbox</h2>
      <p className="description">
        Simulate strategies across historical candlestick pools. Evaluate win rate potential, profit factor margins, and capital drawdown exposure prior to live queue submissions.
      </p>

      {/* Simulator Inputs Card */}
      <div className="card">
        <h3 style={{ color: '#fff', fontSize: 16, marginBottom: 20 }}>Simulation Parameters</h3>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Select Strategy</label>
            <select value={strategy} onChange={e => setStrategy(e.target.value)} style={{ width: 220 }}>
              <option value="VOLATILITY_SQUEEZE">Volatility Squeeze (ATR/BB)</option>
              <option value="MACD_CROSSOVER">MACD Crossover</option>
              <option value="RSI_MEAN_REVERSION">RSI Mean Reversion</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Asset Universe</label>
            <select value={universe} onChange={e => setUniverse(e.target.value)} style={{ width: 180 }}>
              <option value="SMALLCAP_100">Nifty Smallcap 100</option>
              <option value="SMALLCAP_250">Nifty Smallcap 250</option>
              <option value="LARGECAP">Nifty 50 (Large Cap)</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Timeframe</label>
            <select value={timeframe} onChange={e => setTimeframe(e.target.value)} style={{ width: 120 }}>
              <option value="7D">7 Days</option>
              <option value="30D">30 Days</option>
              <option value="90D">90 Days</option>
            </select>
          </div>

          <button onClick={runSimulation} disabled={loading} style={{ height: 45, padding: '0 30px' }}>
            {loading ? 'Running Simulation...' : 'Execute Backtest'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ fontSize: 16, color: 'var(--muted)' }}>Running simulation across historical candles...</div>
        </div>
      )}

      {report && (
        <div style={{ animation: 'slideIn 0.3s ease-out' }}>
          {/* Metrics summary cards */}
          <div className="grid">
            <div className="card stat-container">
              <div className="stat-label">Win Rate</div>
              <div className="stat-value" style={{ color: 'var(--green)' }}>{report.winRate}%</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{report.wins} wins / {report.losses} losses</div>
            </div>
            <div className="card stat-container">
              <div className="stat-label">Profit Factor</div>
              <div className="stat-value" style={{ color: '#a78bfa' }}>{report.profitFactor}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Gross profit / Gross loss ratio</div>
            </div>
            <div className="card stat-container">
              <div className="stat-label">Max Drawdown</div>
              <div className="stat-value" style={{ color: 'var(--green)' }}>{report.drawdown}%</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Risk tolerance target</div>
            </div>
          </div>

          {/* Equity curve chart */}
          <div className="card" style={{ height: 350, padding: '24px 20px 10px 10px' }}>
            <h4 style={{ color: '#fff', fontSize: 16, marginBottom: 20, paddingLeft: 15 }}>Equity Growth Curve (₹)</h4>
            <ResponsiveContainer width="100%" height="85%">
              <AreaChart data={report.equityCurve}>
                <defs>
                  <linearGradient id="backtestEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis dataKey="day" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} label={{ value: 'Trading Day', position: 'insideBottom', offset: -5, fill: '#6b7280' }} />
                <YAxis domain={['auto', 'auto']} stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `₹${v}`} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px', color: '#fff' }} />
                <Area type="monotone" dataKey="equity" stroke="#10b981" fillOpacity={1} fill="url(#backtestEquity)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
