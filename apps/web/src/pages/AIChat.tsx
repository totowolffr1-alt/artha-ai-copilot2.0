import { useState, useRef, useEffect } from 'react';

const API_BASE = '/api';

const SUGGESTIONS = [
  "Should I buy TCS today?",
  "What is my current drawdown?",
  "Analyse RELIANCE fundamentals",
  "What is the market regime?",
  "Screen for delivery opportunities",
  "Show open positions",
];

interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  toolsUsed?: string[];
  suggestions?: Array<{ symbol: string; direction: string; confidence: number }>;
}

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: "Hello! I'm Artha AI Copilot — your autonomous portfolio agent.\n\nI use real tools to answer you:\n📈 Live prices · 📊 Fundamentals (P/E, EPS, ROE) · 📰 Live news · 🌐 Market overview\n\nAsk me anything about a stock or your portfolio!",
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(textToSend: string) {
    const msg = textToSend.trim();
    if (!msg) return;

    setMessages(m => [...m, { role: 'user', text: msg, timestamp: new Date() }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();

      setMessages(m => [...m, {
        role: 'assistant',
        text: data.reply ?? data.error ?? 'No response',
        timestamp: new Date(),
        toolsUsed: data.toolsUsed ?? [],
        suggestions: data.suggestions ?? [],
      }]);
    } catch {
      setMessages(m => [...m, {
        role: 'assistant',
        text: "❌ Error: Couldn't connect to the AI Agent engine.",
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>AI Copilot <span className="badge">AUTONOMOUS AGENT</span></h2>
      <p className="description">
        Tool-calling AI agent. Fetches live prices, fundamentals, news sentiment, and market data before every answer.
      </p>

      <div className="ai-chat-layout">
        {/* Main Chat Panel */}
        <div className="card ai-chat-main-panel">
          {/* Scrollable messages */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 6 }}>
            {messages.map((m, i) => {
              const isUser = m.role === 'user';
              return (
                <div key={i} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: isUser ? '85%' : '92%' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', alignSelf: isUser ? 'flex-end' : 'flex-start', padding: '0 4px' }}>
                      {isUser ? '👤 You' : '🤖 Artha AI'} · {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>

                    {/* Tool Log — shown above assistant messages */}
                    {!isUser && m.toolsUsed && m.toolsUsed.length > 0 && (
                      <div style={{
                        background: 'rgba(167, 139, 250, 0.08)',
                        border: '1px solid rgba(167, 139, 250, 0.2)',
                        borderRadius: 8,
                        padding: '8px 12px',
                        marginBottom: 4,
                      }}>
                        <div style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                          🛠️ Tools Used
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {m.toolsUsed.map((tool, ti) => (
                            <div key={ti} style={{ fontSize: 11, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ color: '#10b981' }}>✓</span> {tool}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Message bubble */}
                    <div style={{
                      background: isUser ? 'var(--accent-gradient)' : 'rgba(255, 255, 255, 0.05)',
                      color: '#fff',
                      padding: '12px 16px',
                      borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      fontSize: 14,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      border: isUser ? 'none' : '1px solid var(--border)',
                      boxShadow: isUser ? '0 4px 15px rgba(99,102,241,0.2)' : 'none',
                    }}>
                      {m.text}
                    </div>

                    {/* Inline suggestions from this message */}
                    {!isUser && m.suggestions && m.suggestions.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                        {m.suggestions.map((s, si) => (
                          <div key={si} style={{
                            fontSize: 11,
                            padding: '4px 10px',
                            borderRadius: 20,
                            background: s.direction === 'LONG'
                              ? 'rgba(16, 185, 129, 0.15)'
                              : 'rgba(239, 68, 68, 0.15)',
                            border: `1px solid ${s.direction === 'LONG' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                            color: s.direction === 'LONG' ? '#10b981' : '#ef4444',
                            fontWeight: 600,
                          }}>
                            {s.direction === 'LONG' ? '▲' : '▼'} {s.symbol} · {s.confidence}%
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {loading && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 6, height: 6,
                      borderRadius: '50%',
                      background: '#a78bfa',
                      animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Agent is querying tools…</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input box */}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send(input)}
              placeholder="Ask about any stock, your portfolio, or strategy…"
              style={{ flex: 1, minWidth: 0 }}
              disabled={loading}
            />
            <button onClick={() => send(input)} disabled={loading || !input.trim()} style={{ whiteSpace: 'nowrap' }}>
              {loading ? '⏳' : 'Send ➤'}
            </button>
          </div>
        </div>

        {/* Sidebar */}
        <div className="ai-chat-side-panel">
          {/* Suggested Queries */}
          <div className="card" style={{ padding: 20 }}>
            <h4 style={{ color: '#fff', fontSize: 13, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Quick Questions
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SUGGESTIONS.map((s, idx) => (
                <button
                  key={idx}
                  className="secondary"
                  onClick={() => send(s)}
                  style={{
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    padding: '9px 12px',
                    fontSize: 12,
                    borderRadius: 8,
                    width: '100%',
                  }}
                  disabled={loading}
                >
                  💬 {s}
                </button>
              ))}
            </div>
          </div>

          {/* How It Works */}
          <div className="card" style={{ padding: 20 }}>
            <h4 style={{ color: '#fff', fontSize: 13, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              How AI Works
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { icon: '📈', label: 'Live Price', desc: 'Real NSE price quotes' },
                { icon: '📊', label: 'Fundamentals', desc: 'P/E, EPS, ROE via FMP' },
                { icon: '📰', label: 'News', desc: 'Sentiment via NewsAPI' },
                { icon: '🌐', label: 'Market', desc: 'VIX, regime, portfolio heat' },
                { icon: '🔍', label: 'Screener', desc: 'Multi-factor stock screen' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 16 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Portfolio-Aware notice */}
          <div className="card" style={{ padding: 16, background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16,185,129,0.2)' }}>
            <div style={{ fontSize: 12, color: '#10b981', fontWeight: 700, marginBottom: 4 }}>
              ✅ Portfolio-Aware
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              AI reads your Angel One holdings before every response. If you already hold a stock, advice will be personalised to your position.
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
