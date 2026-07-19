import { useEffect, useState } from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getWatchlist, getCandles } from '../services/api';

interface CandleData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20?: number;
  ema50?: number;
}

// Custom Candlestick shape for Recharts utilizing yAxis.scale
const CandlestickShape = (props: any) => {
  const { x, width, payload, yAxis } = props;
  if (!payload || !yAxis || !yAxis.scale) return null;

  const { open, close, high, low } = payload;
  const yScale = yAxis.scale;

  const isUp = close >= open;
  const strokeColor = isUp ? 'var(--green)' : 'var(--red)';

  const bodyTop = yScale(Math.max(open, close));
  const bodyBottom = yScale(Math.min(open, close));
  const bodyHeight = Math.max(2, bodyBottom - bodyTop);

  const centerX = x + width / 2;

  return (
    <g>
      {/* Wick (vertical line) */}
      <line
        x1={centerX}
        y1={yScale(high)}
        x2={centerX}
        y2={yScale(low)}
        stroke={strokeColor}
        strokeWidth={1.5}
      />
      {/* Body (rectangle) */}
      <rect
        x={x}
        y={bodyTop}
        width={width}
        height={bodyHeight}
        fill={isUp ? 'var(--green)' : 'var(--red)'}
        stroke={strokeColor}
        strokeWidth={1}
      />
    </g>
  );
};

const FALLBACK_SYMBOLS = [
  { ticker: 'RELIANCE', exchange: 'NSE' },
  { ticker: 'TCS', exchange: 'NSE' },
  { ticker: 'INFY', exchange: 'NSE' },
  { ticker: 'CUPID', exchange: 'NSE' },
  { ticker: 'ZOMATO', exchange: 'NSE' },
  { ticker: 'HDFCBANK', exchange: 'NSE' },
];

export default function Watchlist() {
  const [symbols, setSymbols] = useState<Array<{ ticker: string; exchange: string }>>(FALLBACK_SYMBOLS);
  const [selected, setSelected] = useState('RELIANCE');
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [timeframe, setTimeframe] = useState('1m');
  const [hoveredCandle, setHoveredCandle] = useState<CandleData | null>(null);

  useEffect(() => {
    getWatchlist()
      .then(data => { if (data && data.length > 0) setSymbols(data); })
      .catch(() => { /* keep FALLBACK_SYMBOLS */ });
  }, [];

  useEffect(() => {
    getCandles(selected).then(rawCandles => {
      if (!rawCandles || !Array.isArray(rawCandles)) {
        setCandles([]);
        return;
      }
      // Compute indicators dynamically
      const enriched: CandleData[] = rawCandles.map((c: any, index: number) => {
        const item: CandleData = { ...c };
        
        // Compute SMA20
        if (index >= 19) {
          const sum = rawCandles.slice(index - 19, index + 1).reduce((acc: number, val: any) => acc + val.close, 0);
          item.sma20 = sum / 20;
        }

        // Compute EMA50
        if (index >= 49) {
          const k = 2 / (50 + 1);
          let prevEma = item.close;
          if (index > 49) {
            prevEma = enriched[index - 1].ema50 || item.close;
          }
          item.ema50 = item.close * k + prevEma * (1 - k);
        }

        return item;
      });

      setCandles(enriched);
      if (enriched.length > 0) {
        setHoveredCandle(enriched[enriched.length - 1]); // default to latest
      }
    }).catch(() => {});
  }, [selected, timeframe]);

  return (
    <div>
      <h2>Interactive Charting Terminal <span className="badge">TradingView Style</span></h2>
      <p className="description">
        Professional candlestick charts complete with SMA20/EMA50 overlays, volume bars, and crosshair metrics mapping.
      </p>

      {/* Symbol watch buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25, flexWrap: 'wrap', gap: 15 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {symbols.map(s => {
            const isSelected = selected === s.ticker;
            return (
              <button
                key={s.ticker}
                onClick={() => setSelected(s.ticker)}
                className={isSelected ? '' : 'secondary'}
                style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13 }}
              >
                {s.ticker}
              </button>
            );
          })}
        </div>

        {/* Timeframe Selectors */}
        <div style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,0.03)', padding: 4, borderRadius: 8, border: '1px solid var(--border)' }}>
          {['1m', '5m', '15m', 'Daily'].map(tf => {
            const active = timeframe === tf;
            return (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={active ? '' : 'secondary'}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  boxShadow: 'none',
                  background: active ? 'var(--accent-gradient)' : 'transparent',
                  border: 'none'
                }}
              >
                {tf}
              </button>
            );
          })}
        </div>
      </div>

      {/* Info bar showing OHLC details at cursor */}
      {hoveredCandle && (
        <div style={{ 
          background: 'rgba(255,255,255,0.02)', 
          border: '1px solid var(--border)', 
          borderRadius: 10, 
          padding: '10px 20px', 
          marginBottom: 15,
          display: 'flex',
          gap: 20,
          fontSize: 13,
          fontFamily: 'monospace',
          color: 'var(--muted)',
          flexWrap: 'wrap'
        }}>
          <span>Symbol: <strong style={{ color: '#fff' }}>{selected}</strong></span>
          <span>Open: <strong style={{ color: 'var(--text)' }}>₹{hoveredCandle.open.toFixed(2)}</strong></span>
          <span>High: <strong style={{ color: 'var(--green)' }}>₹{hoveredCandle.high.toFixed(2)}</strong></span>
          <span>Low: <strong style={{ color: 'var(--red)' }}>₹{hoveredCandle.low.toFixed(2)}</strong></span>
          <span>Close: <strong style={{ color: hoveredCandle.close >= hoveredCandle.open ? 'var(--green)' : 'var(--red)' }}>₹{hoveredCandle.close.toFixed(2)}</strong></span>
          <span>Vol: <strong style={{ color: 'var(--text)' }}>{hoveredCandle.volume.toLocaleString()}</strong></span>
          {hoveredCandle.sma20 && <span>SMA20: <strong style={{ color: '#60a5fa' }}>₹{hoveredCandle.sma20.toFixed(2)}</strong></span>}
          {hoveredCandle.ema50 && <span>EMA50: <strong style={{ color: '#a78bfa' }}>₹{hoveredCandle.ema50.toFixed(2)}</strong></span>}
        </div>
      )}

      {/* Chart Card */}
      <div className="card" style={{ height: 460, padding: '24px 20px 10px 10px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={candles}
            onMouseMove={(state: any) => {
              if (state && state.activePayload && state.activePayload.length > 0) {
                setHoveredCandle(state.activePayload[0].payload);
              }
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
            
            <XAxis 
              dataKey="timestamp" 
              tickFormatter={v => new Date(v as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              stroke="#6b7280"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            
            {/* Price axis */}
            <YAxis 
              yAxisId="price"
              domain={['auto', 'auto']} 
              stroke="#6b7280"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              orientation="right"
              tickFormatter={v => `₹${Number(v).toFixed(0)}`}
            />

            {/* Volume axis */}
            <YAxis 
              yAxisId="volume"
              domain={[0, (data: any) => {
                if (!data || !Array.isArray(data) || data.length === 0) return 100000;
                const vols = data.map((c: any) => c.volume || 0);
                return Math.max(...vols) * 4;
              }]} 
              stroke="transparent"
              tickLine={false}
              axisLine={false}
            />

            <Tooltip
              content={<div style={{ display: 'none' }} />} // Handled by info bar overhead
            />

            {/* Volume Bars */}
            <Bar 
              yAxisId="volume"
              dataKey="volume" 
              fill="rgba(99, 102, 241, 0.08)"
              radius={[4, 4, 0, 0]}
            />

            {/* Candlesticks - custom shape using d3 scale directly */}
            <Bar
              yAxisId="price"
              dataKey="close"
              shape={<CandlestickShape />}
            />

            {/* Overlay indicators */}
            <Line 
              yAxisId="price"
              type="monotone" 
              dataKey="sma20" 
              stroke="#60a5fa" 
              dot={false} 
              strokeWidth={1.5}
              connectNulls
            />
            <Line 
              yAxisId="price"
              type="monotone" 
              dataKey="ema50" 
              stroke="#a78bfa" 
              dot={false} 
              strokeWidth={1.5}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'flex', gap: 15, marginTop: 10, paddingLeft: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
          <span style={{ display: 'inline-block', width: 12, height: 3, background: '#60a5fa' }} />
          SMA20
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
          <span style={{ display: 'inline-block', width: 12, height: 3, background: '#a78bfa' }} />
          EMA50
        </div>
      </div>
    </div>
  );
}
