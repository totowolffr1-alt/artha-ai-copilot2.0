import { useEffect, useState } from 'react';

const API_BASE = '/api';

interface Suggestion {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  strategy: string;
  reasoning: string;
  target?: number;
  stopLoss?: number;
  fundamentalRating?: string;
  sentimentScore?: number;
  generatedAt: string;
}

export default function SuggestionBox() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchSuggestions = async () => {
    try {
      const res = await fetch(`${API_BASE}/agent/suggestions`);
      const data = await res.json();
      if (Array.isArray(data.suggestions)) {
        setSuggestions(data.suggestions);
        setLastUpdated(new Date());

        // Proactive alerting: Trigger notification for high confidence setup (>=70%)
        data.suggestions.forEach((s: Suggestion) => {
          if (s.confidence >= 70) {
            triggerPushNotification(s);
          }
        });
      }
    } catch (err) {
      console.error('Failed to fetch suggestions:', err);
    }
  };

  const triggerPushNotification = (s: Suggestion) => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      const nId = `artha-sig-${s.symbol}-${s.generatedAt}`;
      // Prevent duplicate notification popups
      if (localStorage.getItem(nId)) return;

      new Notification(`🧠 Artha AI: ${s.direction} setup on ${s.symbol}`, {
        body: `Confidence: ${s.confidence}% | Target: ₹${s.target ?? 'N/A'} | Stop: ₹${s.stopLoss ?? 'N/A'}`,
        icon: '/favicon.ico',
        tag: s.symbol,
      });

      localStorage.setItem(nId, 'true');
    }
  };

  const handleScreenNow = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/agent/screen`, { method: 'POST' });
      const data = await res.json();
      if (Array.isArray(data.suggestions)) {
        setSuggestions(data.suggestions);
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error('Failed to run proactive screen:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = async (symbol: string) => {
    try {
      await fetch(`${API_BASE}/agent/suggestions/${symbol}`, { method: 'DELETE' });
      setSuggestions(prev => prev.filter(s => s.symbol !== symbol));
    } catch (err) {
      console.error('Failed to dismiss suggestion:', err);
    }
  };

  useEffect(() => {
    // Request notification permission on mount
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    fetchSuggestions();
    const interval = setInterval(fetchSuggestions, 30000); // poll every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="card" style={{ marginBottom: 25, padding: 20, border: '1px solid rgba(167, 139, 250, 0.25)', background: 'rgba(167, 139, 250, 0.02)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            🧠 AI Decision Support Box
          </h3>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>
            Real-time multi-factor scanning: FMP Fundamentals + NewsAPI Sentiment.
            {lastUpdated && ` Last updated: ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        <button
          onClick={handleScreenNow}
          disabled={loading}
          style={{
            background: 'var(--accent-gradient)',
            border: 'none',
            padding: '8px 16px',
            fontSize: 12,
            borderRadius: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          {loading ? '🔍 Screening...' : 'Screen Watchlist Now'}
        </button>
      </div>

      {suggestions.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          No trade suggestions generated yet. Click above to run an active market scan.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {suggestions.map(s => {
            const isLong = s.direction === 'LONG';
            const sigColor = isLong ? '#10b981' : '#ef4444';
            return (
              <div
                key={s.symbol}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{s.symbol}</span>
                    <span style={{
                      fontSize: 10,
                      padding: '2px 8px',
                      borderRadius: 20,
                      background: isLong ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: sigColor,
                      fontWeight: 700,
                    }}>
                      {s.direction === 'LONG' ? '▲ BULLISH (LONG)' : '▼ BEARISH (SHORT)'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>({s.strategy})</span>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 6 }}>
                    {s.reasoning.split('🎯')[0]}
                  </div>

                  <div style={{ display: 'flex', gap: 16, fontSize: 11, fontWeight: 600 }}>
                    {s.target && <span style={{ color: '#10b981' }}>Target: ₹{s.target}</span>}
                    {s.stopLoss && <span style={{ color: '#ef4444' }}>SL: ₹{s.stopLoss}</span>}
                    {s.fundamentalRating && <span style={{ color: 'var(--muted)' }}>FMP: {s.fundamentalRating}</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {/* Confidence Meter */}
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Confidence</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: s.confidence >= 70 ? '#a78bfa' : '#fff' }}>
                      {s.confidence}%
                    </div>
                  </div>

                  {/* Dismiss */}
                  <button
                    onClick={() => handleDismiss(s.symbol)}
                    className="secondary"
                    style={{
                      padding: '6px 10px',
                      fontSize: 11,
                      borderRadius: 6,
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      color: 'var(--muted)',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
