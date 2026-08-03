import React from 'react';

export interface ReasoningStep {
  step: number;
  signal: string;
  finding: string;
  implication: string;
  weight: string;
  verdict: string;
}

export interface ExplanationReport {
  symbol: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  confidenceLabel: string;
  summary: string;
  reasoningChain: ReasoningStep[];
  keyRisk: string;
  watchLevels: { resistance: number; support: number };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  explanation: ExplanationReport | null;
}

export default function ReasoningModal({ isOpen, onClose, explanation }: Props) {
  if (!isOpen || !explanation) return null;

  const isUp = explanation.direction === 'BULLISH';

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.85)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 2000,
      padding: 16, backdropFilter: 'blur(8px)',
      animation: 'fadeIn 0.2s ease-out',
    }}>
      <div style={{
        background: '#0d1117', border: '1px solid rgba(99,102,241,0.3)',
        borderRadius: 16, maxWidth: 800, width: '100%',
        maxHeight: '90vh', overflowY: 'auto', display: 'flex',
        flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 24px', borderBottom: '1px solid rgba(99,102,241,0.15)',
          background: 'rgba(99,102,241,0.05)',
        }}>
          <div>
            <h3 style={{ margin: 0, color: '#fff', fontSize: 18 }}>
              📊 {explanation.symbol} Reasoning Chain Analysis
            </h3>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Confidence-Aware Decision Support Model (Explainable AI)
            </span>
          </div>
          <button onClick={onClose} className="secondary" style={{ padding: '6px 12px', borderRadius: 8 }}>
            ✕ Close
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Signal summary */}
          <div style={{
            background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 10,
            borderLeft: `4px solid ${isUp ? '#10b981' : '#ef4444'}`
          }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 14, color: isUp ? '#34d399' : '#f87171', textTransform: 'uppercase' }}>
              Verdict: {explanation.direction} ({explanation.confidence}% Confidence)
            </h4>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#d1d5db' }}>
              {explanation.summary}
            </p>
          </div>

          {/* Reasoning Table */}
          <div>
            <h4 style={{ margin: '0 0 12px 0', fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase' }}>
              Chain-of-Thought (CoT) Signal Decomposition
            </h4>
            <div className="table-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ textAlign: 'left', padding: 8, color: 'var(--muted)' }}>Step</th>
                    <th style={{ textAlign: 'left', padding: 8, color: 'var(--muted)' }}>Indicator</th>
                    <th style={{ textAlign: 'left', padding: 8, color: 'var(--muted)' }}>Finding</th>
                    <th style={{ textAlign: 'left', padding: 8, color: 'var(--muted)' }}>Implication</th>
                    <th style={{ textAlign: 'center', padding: 8, color: 'var(--muted)' }}>Weight</th>
                    <th style={{ textAlign: 'right', padding: 8, color: 'var(--muted)' }}>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {explanation.reasoningChain.map(step => {
                    const stepMatches = step.verdict.includes('SUPPORTS');
                    return (
                      <tr key={step.step} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: 10, color: 'var(--muted)', fontWeight: 600 }}>{step.step}</td>
                        <td style={{ padding: 10, fontWeight: 700, color: '#fff' }}>{step.signal}</td>
                        <td style={{ padding: 10, fontFamily: 'monospace' }}>{step.finding}</td>
                        <td style={{ padding: 10, color: '#e5e7eb', lineHeight: 1.3 }}>{step.implication}</td>
                        <td style={{ padding: 10, textAlign: 'center', color: 'var(--muted)' }}>{step.weight}</td>
                        <td style={{
                          padding: 10, textAlign: 'right', fontWeight: 600,
                          color: stepMatches ? '#34d399' : '#f87171'
                        }}>
                          {stepMatches ? '✅ Support' : '❌ Contradict'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Watch levels & Risks */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', padding: 14, borderRadius: 10 }}>
              <h5 style={{ margin: '0 0 6px 0', color: '#f87171', fontSize: 12, textTransform: 'uppercase' }}>
                ⚠️ Key System Flagged Risk
              </h5>
              <p style={{ margin: 0, fontSize: 12, color: '#fca5a5', lineHeight: 1.4 }}>
                {explanation.keyRisk}
              </p>
            </div>
            <div style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)', padding: 14, borderRadius: 10 }}>
              <h5 style={{ margin: '0 0 6px 0', color: '#a78bfa', fontSize: 12, textTransform: 'uppercase' }}>
                🎯 Dynamic Watch Targets
              </h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontFamily: 'monospace' }}>
                <div>Resistance: <strong style={{ color: '#fff' }}>₹{explanation.watchLevels.resistance}</strong></div>
                <div>Support: <strong style={{ color: '#fff' }}>₹{explanation.watchLevels.support}</strong></div>
              </div>
            </div>
          </div>
        </div>

        {/* Disclaimer Footer */}
        <div style={{
          padding: '12px 24px', borderTop: '1px solid rgba(255,255,255,0.05)',
          background: 'rgba(0,0,0,0.3)', fontSize: 11, color: 'var(--muted)',
          textAlign: 'center', lineHeight: 1.4,
        }}>
          ⚠️ <strong>Decision Support Disclaimer:</strong> This framework utilizes pure mathematical indicators and rules-based analysis models. It does not access external financial advice. Final trading calls and risks belong strictly to the operator.
        </div>
      </div>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
