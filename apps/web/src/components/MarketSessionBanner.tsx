import { useEffect, useState } from 'react';
import { getMarketSession, formatCountdown, type MarketSession } from '../services/marketSession';

export default function MarketSessionBanner() {
  const [session, setSession] = useState<MarketSession>(getMarketSession());

  useEffect(() => {
    const tick = () => setSession(getMarketSession());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const colors: Record<string, { bg: string; border: string; dot: string; text: string }> = {
    OPEN:     { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)', dot: '#10b981', text: '#34d399' },
    PRE_OPEN: { bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.3)', dot: '#fbbf24', text: '#fcd34d' },
    CLOSED:   { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.3)',  dot: '#ef4444', text: '#f87171' },
    WEEKEND:  { bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.3)', dot: '#6b7280', text: '#9ca3af' },
  };

  const c = colors[session.status] || colors.CLOSED;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10,
      padding: '10px 18px', marginBottom: 20, flexWrap: 'wrap', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', background: c.dot, display: 'inline-block',
          boxShadow: `0 0 6px ${c.dot}`,
          animation: session.isOpen ? 'pulse 1.5s infinite' : 'none',
        }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: c.text, letterSpacing: 1 }}>
          {session.status.replace('_', '-')}
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{session.message}</span>
      </div>
      <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>
        {session.isOpen && session.closesIn > 0 && (
          <span>Closes in <strong style={{ color: '#fff' }}>{formatCountdown(session.closesIn)}</strong></span>
        )}
        {!session.isOpen && session.countdown > 0 && (
          <span>Opens in <strong style={{ color: '#fff' }}>{formatCountdown(session.countdown)}</strong></span>
        )}
        <span>IST {new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
