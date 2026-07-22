import { useState, useRef, useEffect } from 'react';
import { sendChatMessage } from '../services/api';
import { watchlistStore } from '../services/watchlistStore';
import { getMarketSession } from '../services/marketSession';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  source?: 'local' | 'groq' | 'offline';
}

const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  source: 'local',
  text: [
    `🤖 **Artha AI Copilot** — Powered by Groq LLaMA 3.3`,
    ``,
    `I'm your expert Indian stock market assistant with full context of:`,
    `  • Your watchlist: ${watchlistStore.getAllSymbols().slice(0, 5).join(', ')}…`,
    `  • Market: **${getMarketSession().status}** ${getMarketSession().isOpen ? '🟢' : '🔴'}`,
    `  • Mode: **${(import.meta as any).env?.VITE_TRADING_MODE || 'SWING'}**`,
    ``,
    `Ask me anything — stock analysis, live prices, news, backtesting, or say **"Watch CUPID"** or **"Backtest MACD on CUPID"**!`,
  ].join('\n'),
  timestamp: new Date().toISOString(),
};

const SUGGESTIONS = [
  "Why did CUPID rally today?",
  "Backtest Volatility Squeeze on CUPID for 30 days",
  "What is SilverBeES trading at?",
  "Best swing setups for this week?",
  "Explain VWAP trading strategy",
  "Show my watchlist",
  "Is market open right now?",
  "How to trade breakouts in small caps?",
];

export default function AIChat() {
  const session = getMarketSession();
  
  // Fix 2: SessionStorage Chat Persistence
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = sessionStorage.getItem('artha_chat_history_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [INITIAL_MESSAGE];
  });

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Save chat to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('artha_chat_history_v1', JSON.stringify(messages.slice(-50)));
    } catch {}
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const clearChat = () => {
    try {
      sessionStorage.removeItem('artha_chat_history_v1');
    } catch {}
    setMessages([INITIAL_MESSAGE]);
  };

  async function send(textToSend: string) {
    const msg = textToSend.trim();
    if (!msg || loading) return;

    const userMsg: Message = { role: 'user', text: msg, timestamp: new Date().toISOString() };
    setMessages(m => [...m, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await sendChatMessage(msg);

      // If local watchlist action, update store
      if (res.action === 'WATCH' && res.symbol) {
        watchlistStore.addStock(watchlistStore.getActive(), res.symbol);
      } else if (res.action === 'UNWATCH' && res.symbol) {
        watchlistStore.removeStock(watchlistStore.getActive(), res.symbol);
      }

      setMessages(m => [...m, {
        role: 'assistant',
        text: res.reply || 'No response.',
        source: res.source || 'groq',
        timestamp: new Date().toISOString(),
      }]);
    } catch {
      setMessages(m => [...m, {
        role: 'assistant',
        text: '⚠️ Could not reach AI engine. Check that the API server is running.',
        source: 'offline',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  function getSourceBadge(source?: string) {
    if (source === 'local') return { label: '⚡ Instant', color: '#10b981' };
    if (source === 'groq') return { label: '🧠 Groq AI', color: '#a78bfa' };
    if (source === 'offline') return { label: '📴 Offline', color: '#f87171' };
    return null;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>🤖 AI Copilot <span className="badge">GROQ POWERED</span></h2>
        <button onClick={clearChat} className="secondary" style={{ fontSize: 12, padding: '6px 12px' }}>
          🗑 Clear History
        </button>
      </div>

      <p className="description">
        Hybrid AI with zero-guessing data integration: instant local commands + Groq LLaMA 3.3 with real price, news & backtest tools.
      </p>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Main Chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '680px' }} className="card">
          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 6 }}>
            {messages.map((m, i) => {
              const isUser = m.role === 'user';
              const badge = !isUser ? getSourceBadge(m.source) : null;
              const dateObj = new Date(m.timestamp);
              return (
                <div key={i} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '80%' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', alignSelf: isUser ? 'flex-end' : 'flex-start', display: 'flex', gap: 8, alignItems: 'center' }}>
                      {isUser ? '👤 You' : '🤖 Artha AI'}
                      {badge && <span style={{ fontSize: 10, color: badge.color, background: `${badge.color}20`, padding: '1px 6px', borderRadius: 4 }}>{badge.label}</span>}
                      <span style={{ opacity: 0.6 }}>· {isNaN(dateObj.getTime()) ? '' : dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div style={{
                      background: isUser ? 'var(--accent-gradient)' : 'rgba(255,255,255,0.04)',
                      color: '#fff', padding: '12px 16px',
                      borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                      border: isUser ? 'none' : '1px solid var(--border)',
                      boxShadow: isUser ? '0 4px 15px rgba(99,102,241,0.2)' : 'none',
                    }}>
                      {m.text}
                    </div>
                  </div>
                </div>
              );
            })}
            {loading && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13, padding: '8px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                Groq LLaMA 3.3 analyzing market data…
                <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send(input)}
              placeholder='Ask anything — "Why did CUPID rally?" or "Backtest MACD on CUPID"'
              style={{ flex: 1 }}
              disabled={loading}
            />
            <button onClick={() => send(input)} disabled={loading || !input.trim()} style={{ padding: '12px 20px' }}>
              {loading ? '…' : '↑ Send'}
            </button>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Suggestions */}
          <div className="card" style={{ padding: 18 }}>
            <h4 style={{ color: '#fff', fontSize: 13, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>💬 Try Asking</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} className="secondary" onClick={() => send(s)}
                  style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '8px 12px', fontSize: 12, borderRadius: 8, width: '100%' }}
                  disabled={loading}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div className="card" style={{ padding: 18 }}>
            <h4 style={{ color: '#fff', fontSize: 13, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>⚙️ AI Engine</h4>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
              <div>🧠 Model: <span style={{ color: '#a78bfa' }}>LLaMA 3.3-70B</span></div>
              <div>⚡ Tools: <span style={{ color: '#60a5fa' }}>Price, News, Backtest</span></div>
              <div>📍 Market: <span style={{ color: session.isOpen ? '#10b981' : '#f87171' }}>{session.status}</span></div>
              <div>📋 Watching: <span style={{ color: '#fff' }}>{watchlistStore.getAllSymbols().length} stocks</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
