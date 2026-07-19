import { useState, useRef, useEffect } from 'react';
import { sendChatMessage } from '../services/api';

const SUGGESTIONS = [
  "Why was TCS rejected today?",
  "What is my current drawdown?",
  "Show my watchlist",
  "What is the market regime?",
  "Show open positions"
];

export default function AIChat() {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string; timestamp: Date }>>([
    {
      role: 'assistant',
      text: "Hello! I am your Artha Copilot. I proactively monitor all 9 backend engines (Risk, Broker, Safety, Learning, etc.) to keep your capital safe and surface high-confidence opportunities. Ask me anything!",
      timestamp: new Date()
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
      const res = await sendChatMessage(msg);
      setMessages(m => [...m, { role: 'assistant', text: res.reply, timestamp: new Date() }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', text: "Error: Couldn't connect to Copilot engine.", timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>AI Copilot <span className="badge">PROACTIVE</span></h2>
      <p className="description">
        Your eager, proactive trading assistant. Monitors indicators, tracks stop-hits, evaluates risk, and suggests high-probability setups.
      </p>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Main Chat Panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '650px' }} className="card">
          {/* Scrollable messages */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 10 }}>
            {messages.map((m, i) => {
              const isUser = m.role === 'user';
              return (
                <div key={i} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '75%' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', alignSelf: isUser ? 'flex-end' : 'flex-start', padding: '0 4px' }}>
                      {isUser ? '👤 You' : '🤖 Artha Copilot'} · {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{
                      background: isUser ? 'var(--accent-gradient)' : 'rgba(255, 255, 255, 0.05)',
                      color: '#fff',
                      padding: '12px 16px',
                      borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      fontSize: 14,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
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
              <div style={{ alignSelf: 'flex-start', color: 'var(--muted)', fontSize: 13, padding: '0 12px' }}>
                Copilot is thinking...
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input box */}
          <div style={{ display: 'flex', gap: 10, marginTop: 20, paddingTop: 15, borderTop: '1px solid var(--border)' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send(input)}
              placeholder="Ask about a stock, your portfolio, or a strategy…"
              style={{ flex: 1 }}
              disabled={loading}
            />
            <button onClick={() => send(input)} disabled={loading}>
              {loading ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>

        {/* Sidebar Suggestions */}
        <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card" style={{ padding: 20 }}>
            <h4 style={{ color: '#fff', fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Suggested Queries
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
                    padding: '10px 14px',
                    fontSize: 13,
                    borderRadius: 8,
                    width: '100%'
                  }}
                  disabled={loading}
                >
                  💬 {s}
                </button>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <h4 style={{ color: '#fff', fontSize: 14, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Copilot Intel
            </h4>
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
              All responses are fetched directly from the Phase 10 Decision Support engine.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
