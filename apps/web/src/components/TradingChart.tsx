import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
} from 'lightweight-charts';

import { subscribeTicks, type Tick } from '../services/api';

const BASE_URL = '/api';

const TIMEFRAMES = ['1m','5m','15m','30m','1h','4h','D','W','M','1Y','5Y'] as const;
type Timeframe = typeof TIMEFRAMES[number];

const TF_TO_RANGE: Record<Timeframe, string> = {
  '1m': '1D', '5m': '5D', '15m': '1M', '30m': '3M',
  '1h': '6M', '4h': '1Y', 'D': '1Y', 'W': '3Y', 'M': '5Y',
  '1Y': '1Y', '5Y': '5Y',
};

const INDICATORS = ['EMA9','EMA20','EMA50','SMA20','VWAP','BB','RSI','MACD'] as const;
type Indicator = typeof INDICATORS[number];

interface Props {
  symbol: string;
  onClose?: () => void;
  fullscreen?: boolean;
}

// ── Math helpers ──────────────────────────────────────────────────────────────
function calcEMA(data: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(period - 1).fill(null);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(ema);
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calcSMA(data: number[], period: number): (number | null)[] {
  return data.map((_, i) =>
    i < period - 1 ? null : data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
  );
}

function calcBB(data: number[], period = 20, stdDev = 2) {
  const sma = calcSMA(data, period);
  return data.map((_, i) => {
    if (i < period - 1) return { upper: null, lower: null, mid: null };
    const slice = data.slice(i - period + 1, i + 1);
    const mean = sma[i] as number;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    return { upper: mean + stdDev * std, lower: mean - stdDev * std, mid: mean };
  });
}

function formatChartTime(time: any): string {
  if (!time) return '';
  if (typeof time === 'number') {
    const d = new Date(time * 1000);
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  }
  if (typeof time === 'object' && time.year) {
    return `${time.day || ''} ${time.month || ''} ${time.year}`;
  }
  return String(time);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TradingChart({ symbol, onClose, fullscreen = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lineSeriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const lastCandleRef = useRef<any>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>('D');
  const [activeIndicators, setActiveIndicators] = useState<Set<Indicator>>(new Set(['EMA20', 'EMA50']));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ohlcv, setOhlcv] = useState({ o: 0, h: 0, l: 0, c: 0, v: 0, t: '' });
  const [periodStats, setPeriodStats] = useState({ startPrice: 0, endPrice: 0, pnl: 0, pnlPct: 0 });
  const [isFullscreen, setIsFullscreen] = useState(fullscreen);

  const toggleIndicator = (ind: Indicator) => {
    setActiveIndicators(prev => {
      const next = new Set(prev);
      next.has(ind) ? next.delete(ind) : next.add(ind);
      return next;
    });
  };

  const loadData = useCallback(async () => {
    if (!containerRef.current) return;
    setLoading(true);
    setError('');

    try {
      const range = TF_TO_RANGE[timeframe];
      const res = await fetch(`${BASE_URL}/market/historical?symbol=${symbol}&range=${range}`);
      const json = await res.json();
      const raw: any[] = json.candles || [];

      if (raw.length === 0) throw new Error('No data');

      const candleData: CandlestickData<Time>[] = raw.map(c => ({
        time: Math.floor(new Date(c.timestamp).getTime() / 1000) as Time,
        open: c.open, high: c.high, low: c.low, close: c.close,
      }));

      const volData = raw.map(c => ({
        time: Math.floor(new Date(c.timestamp).getTime() / 1000) as Time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)',
      }));

      const closes = raw.map(c => c.close);
      const times = raw.map(c => Math.floor(new Date(c.timestamp).getTime() / 1000) as Time);

      // Period P&L calculation over loaded timeframe range
      const startPrice = raw[0].open || raw[0].close;
      const endPrice = raw[raw.length - 1].close;
      const pnl = endPrice - startPrice;
      const pnlPct = startPrice > 0 ? (pnl / startPrice) * 100 : 0;
      setPeriodStats({
        startPrice: parseFloat(startPrice.toFixed(2)),
        endPrice: parseFloat(endPrice.toFixed(2)),
        pnl: parseFloat(pnl.toFixed(2)),
        pnlPct: parseFloat(pnlPct.toFixed(2)),
      });

      // Clear old line series
      lineSeriesRefs.current.forEach(s => { try { chartRef.current?.removeSeries(s); } catch {} });
      lineSeriesRefs.current = [];

      candleSeriesRef.current?.setData(candleData);
      volumeSeriesRef.current?.setData(volData);

      // Store last candle for live tick updates
      if (candleData.length > 0) {
        lastCandleRef.current = { ...candleData[candleData.length - 1] };
      }

      // Indicator overlays
      const addLine = (values: (number | null)[], color: string, lineWidth: number = 1) => {
        const series = chartRef.current!.addSeries(LineSeries, {
          color, lineWidth: lineWidth as any, priceLineVisible: false, lastValueVisible: false,
        });
        series.setData(values.map((v, i) => v !== null ? { time: times[i], value: v } : null).filter(Boolean) as any);
        lineSeriesRefs.current.push(series);
        return series;
      };

      if (activeIndicators.has('EMA9'))  addLine(calcEMA(closes, 9),  '#f59e0b');
      if (activeIndicators.has('EMA20')) addLine(calcEMA(closes, 20), '#60a5fa');
      if (activeIndicators.has('EMA50')) addLine(calcEMA(closes, 50), '#a78bfa', 2);
      if (activeIndicators.has('SMA20')) addLine(calcSMA(closes, 20), '#34d399');

      if (activeIndicators.has('BB')) {
        const bb = calcBB(closes);
        addLine(bb.map(b => b.upper), 'rgba(99,102,241,0.6)');
        addLine(bb.map(b => b.mid),   'rgba(99,102,241,0.4)');
        addLine(bb.map(b => b.lower), 'rgba(99,102,241,0.6)');
      }

      if (activeIndicators.has('VWAP')) {
        let cumTPV = 0, cumVol = 0;
        const vwap = raw.map(c => {
          const tp = (c.high + c.low + c.close) / 3;
          cumTPV += tp * c.volume;
          cumVol += c.volume;
          return cumVol ? cumTPV / cumVol : null;
        });
        addLine(vwap, '#f97316', 2);
      }

      chartRef.current?.timeScale().fitContent();

      const last = raw[raw.length - 1];
      setOhlcv({
        o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume,
        t: formatChartTime(new Date(last.timestamp).getTime() / 1000),
      });

    } catch (e: any) {
      setError('Could not load chart data.');
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, activeIndicators]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#090c10' },
        textColor: '#9ca3af',
        fontSize: 12,
        fontFamily: 'system-ui, -apple-system, Roboto, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: 'rgba(255,255,255,0.03)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(99,102,241,0.6)',
          labelBackgroundColor: '#6366f1',
          visible: true,
        },
        horzLine: {
          color: 'rgba(99,102,241,0.6)',
          labelBackgroundColor: '#6366f1',
          visible: true,
        },
      },
      rightPriceScale: { borderColor: 'rgba(99,102,241,0.2)' },
      timeScale: {
        borderColor: 'rgba(99,102,241,0.2)',
        timeVisible: true,
        secondsVisible: true,
      },
      width: containerRef.current.clientWidth,
      height: isFullscreen ? window.innerHeight - 150 : 500,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444',
      borderUpColor: '#10b981', borderDownColor: '#ef4444',
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0.05 } });

    // Exact date/time formatting on crosshair hover
    chart.subscribeCrosshairMove((param) => {
      if (param.seriesData.size > 0 && param.time) {
        const data = param.seriesData.get(candleSeries) as any;
        const formattedTime = formatChartTime(param.time);
        if (data) {
          setOhlcv({
            o: data.open,
            h: data.high,
            l: data.low,
            c: data.close,
            v: 0,
            t: formattedTime,
          });
        }
      }
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volSeries;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current?.clientWidth || 800 });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); };
  }, [isFullscreen]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Live tick subscription — updates current candle bar in real-time ──────
  useEffect(() => {
    const getAlignedTime = (timestamp: string, tf: string): number => {
      const ms = new Date(timestamp).getTime();
      if (tf === '1m')  return Math.floor(ms / 60_000)    * 60;
      if (tf === '5m')  return Math.floor(ms / 300_000)   * 300;
      if (tf === '15m') return Math.floor(ms / 900_000)   * 900;
      if (tf === '30m') return Math.floor(ms / 1_800_000) * 1_800;
      if (tf === '1h')  return Math.floor(ms / 3_600_000) * 3_600;
      if (tf === '4h')  return Math.floor(ms / 14_400_000)* 14_400;
      // Daily+: align to start of day (UTC midnight)
      const d = new Date(ms); d.setUTCHours(0, 0, 0, 0);
      return Math.floor(d.getTime() / 1000);
    };

    const unsubscribe = subscribeTicks((tick: Tick) => {
      if (tick.symbol !== symbol) return;
      if (!candleSeriesRef.current || !lastCandleRef.current) return;

      const alignedTime = getAlignedTime(tick.timestamp || new Date().toISOString(), timeframe) as Time;
      const prev = lastCandleRef.current;
      let updated: any;

      if (alignedTime === prev.time) {
        // Update existing bar
        updated = {
          time:  alignedTime,
          open:  prev.open,
          high:  Math.max(prev.high, tick.price),
          low:   Math.min(prev.low,  tick.price),
          close: tick.price,
        };
      } else if ((alignedTime as number) > (prev.time as number)) {
        // New bar started
        updated = { time: alignedTime, open: tick.price, high: tick.price, low: tick.price, close: tick.price };
      } else {
        return; // stale tick — ignore
      }

      lastCandleRef.current = updated;

      try { candleSeriesRef.current.update(updated); } catch {}
      try {
        volumeSeriesRef.current?.update({
          time:  alignedTime,
          value: (tick as any).volume || 10,
          color: updated.close >= updated.open ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)',
        });
      } catch {}

      setOhlcv(prev => ({
        o: updated.open,
        h: updated.high,
        l: updated.low,
        c: updated.close,
        v: (tick as any).volume || prev.v,
        t: formatChartTime(alignedTime),
      }));
    });

    return () => unsubscribe();
  }, [symbol, timeframe]);

  const changeColor = ohlcv.c >= ohlcv.o ? '#10b981' : '#ef4444';
  const isPeriodPositive = periodStats.pnl >= 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 0,
      background: '#090c10',
      border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: isFullscreen ? 0 : 16,
      overflow: 'hidden',
      position: isFullscreen ? 'fixed' : 'relative',
      inset: isFullscreen ? 0 : 'auto',
      zIndex: isFullscreen ? 1000 : 1,
      paddingBottom: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>{symbol}</span>
          <span style={{ fontFamily: 'monospace', fontSize: 14, color: changeColor, fontWeight: 700 }}>
            ₹{ohlcv.c.toFixed(2)}
          </span>

          {/* Period Total Return (1Y / 5Y / Timeframe Profit & Loss) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px',
            background: isPeriodPositive ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            border: `1px solid ${isPeriodPositive ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
            borderRadius: 6, fontSize: 13, fontFamily: 'monospace',
          }}>
            <span style={{ color: '#d1d5db', fontSize: 12 }}>{timeframe} Period Return:</span>
            <strong style={{ color: isPeriodPositive ? '#34d399' : '#f87171', fontSize: 13 }}>
              {isPeriodPositive ? '+' : ''}₹{periodStats.pnl.toFixed(2)} ({isPeriodPositive ? '+' : ''}{periodStats.pnlPct.toFixed(2)}%)
            </strong>
          </div>

          {loading && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Loading...</span>}
          {error && <span style={{ fontSize: 11, color: 'var(--red)' }}>{error}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setIsFullscreen(!isFullscreen)} className="secondary" style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6 }}>
            {isFullscreen ? '✕ Exit' : '⛶ Full'}
          </button>
          {onClose && <button onClick={onClose} className="secondary" style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6 }}>✕</button>}
        </div>
      </div>

      {/* OHLCV & Exact Hover Timestamp Bar */}
      {ohlcv.o > 0 && (
        <div style={{
          display: 'flex', gap: 16, padding: '8px 16px', background: 'rgba(99,102,241,0.08)',
          borderBottom: '1px solid rgba(99,102,241,0.15)', fontSize: 13, fontFamily: 'monospace',
          flexWrap: 'wrap', alignItems: 'center',
        }}>
          {ohlcv.t && (
            <span style={{
              background: '#6366f1', color: '#fff', padding: '2px 8px', borderRadius: 4,
              fontWeight: 700, fontSize: 12, boxShadow: '0 2px 6px rgba(99,102,241,0.4)',
            }}>
              📅 {ohlcv.t}
            </span>
          )}
          <span>O: <strong style={{ color: '#fff' }}>₹{ohlcv.o.toFixed(2)}</strong></span>
          <span>H: <strong style={{ color: '#10b981' }}>₹{ohlcv.h.toFixed(2)}</strong></span>
          <span>L: <strong style={{ color: '#ef4444' }}>₹{ohlcv.l.toFixed(2)}</strong></span>
          <span>C: <strong style={{ color: changeColor }}>₹{ohlcv.c.toFixed(2)}</strong></span>
        </div>
      )}

      {/* Timeframe Selector */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 16px', background: 'rgba(0,0,0,0.2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 8 }}>TIMEFRAME</span>
        {TIMEFRAMES.map(tf => (
          <button key={tf} onClick={() => setTimeframe(tf)}
            style={{
              padding: '3px 10px', fontSize: 12, borderRadius: 6,
              background: timeframe === tf ? 'var(--accent-gradient)' : 'transparent',
              border: timeframe === tf ? 'none' : '1px solid rgba(255,255,255,0.1)',
              boxShadow: 'none', color: timeframe === tf ? '#fff' : 'var(--muted)',
            }}>
            {tf}
          </button>
        ))}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 12, marginRight: 8 }}>INDICATORS</span>
        {INDICATORS.map(ind => (
          <button key={ind} onClick={() => toggleIndicator(ind)}
            style={{
              padding: '3px 10px', fontSize: 11, borderRadius: 6,
              background: activeIndicators.has(ind) ? 'rgba(99,102,241,0.3)' : 'transparent',
              border: `1px solid ${activeIndicators.has(ind) ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.1)'}`,
              boxShadow: 'none', color: activeIndicators.has(ind) ? '#a78bfa' : 'var(--muted)',
            }}>
            {ind}
          </button>
        ))}
      </div>

      {/* Chart Canvas */}
      <div ref={containerRef} style={{ width: '100%', minHeight: isFullscreen ? 'calc(100vh - 160px)' : 500, paddingBottom: 10 }} />
    </div>
  );
}
