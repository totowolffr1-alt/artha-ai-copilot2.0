import React, { useState, useEffect } from 'react';
import ReasoningModal from './ReasoningModal';

interface Props {
  symbol: string;
}

interface SignalDetail {
  value: number | string;
  condition: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  contribution: number;
  message: string;
}

interface ConfidenceReport {
  symbol: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  confidenceLabel: string;
  signals: {
    rsi: SignalDetail;
    macd: SignalDetail;
    dma200: SignalDetail;
    volume: SignalDetail;
    news: SignalDetail;
  };
  conflicts: string[];
  dataFreshness: string;
  price: number;
}

export default function ConfidenceCard({ symbol }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ConfidenceReport | null>(null);
  const [explanation, setExplanation] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [accuracyStats, setAccuracyStats] = useState<any>(null);

  useEffect(() => {
    let active = true;
    const fetchConfidence = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/analysis/confidence?symbol=${symbol}`);
        if (!res.ok) throw new Error('Analysis service offline');
        const data = await res.json();
        
        if (active) {
          setReport(data.report);
          setExplanation(data.explanation);
        }

        // Fetch backtest accuracy stats
        const statsRes = await fetch('/api/analysis/stats');
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          if (active) setAccuracyStats(statsData);
        }
      } catch (err: any) {
        if (active) setError(err.message || 'Could not evaluate signal confidence.');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchConfidence();
    return () => { active = false; };
  }, [symbol]);

  if (loading) {
    return (
      <div className="card" style={{ padding: 20, textAlign: 'center', background: '#090c10', border: '1px solid rgba(99,102,241,0.1)' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>🤖 Computing Explainable AI signal confidence...</span>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="card" style={{ padding: 20, background: '#090c10', border: '1px solid rgba(239,68,68,0.2)' }}>
        <h4 style={{ margin: '0 0 6px 0', fontSize: 13, color: '#f87171' }}>⚠️ Analysis Unavailable</h4>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{error || 'No historical signals exist for this symbol.'}</span>
      </div>
    );
  }

  const isUp = report.direction === 'BULLISH';
  const isDown = report.direction === 'BEARISH';
  const color = isUp ? '#10b981' : isDown ? '#ef4444' : '#9ca3af';

  // Determine meter bar colors based on confidence
  const meterBars = Array.from({ length: 10 }).map((_, i) => {
    const active = report.confidence >= (i + 1) * 10;
    let barColor = 'rgba(255,255,255,0.05)';
    if (active) {
      if (report.confidence >= 70) barColor = '#10b981'; // Green
      else if (report.confidence >= 50) barColor = '#fbbf24'; // Yellow
      else barColor = '#ef4444'; // Red
    }
    return <span key={i} style={{ flex: 1, height: 8, background: barColor, borderRadius: 2, transition: 'all 0.3s' }} />;
  });

  return (
    <div className="card animate-fade-in" style={{
      padding: '20px 24px',
      background: 'rgba(9, 12, 16, 0.95)',
      border: '1px solid rgba(99, 102, 241, 0.2)',
      borderRadius: 16,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background glow overlay */}
      <div style={{
        position: 'absolute', top: -30, right: -30, width: 90, height: 90,
        background: isUp ? 'rgba(16,185,129,0.06)' : isDown ? 'rgba(239,68,68,0.06)' : 'rgba(99,102,241,0.06)',
        filter: 'blur(30px)', pointerEvents: 'none', borderRadius: '50%'
      }} />

      {/* Header info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 14, color: '#fff', fontWeight: 700 }}>
            🧠 Artha XAI Advisor
          </h4>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            Strict Rules-Based Decision Support
          </span>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, color, background: `${color}15`,
          border: `1px solid ${color}30`, padding: '2px 8px', borderRadius: 6,
          textTransform: 'uppercase'
        }}>
          {report.direction === 'NEUTRAL' ? 'Neutral Hold' : `${report.direction} Entry`}
        </span>
      </div>

      {/* Confidence Meter */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>Signal Confidence:</span>
          <span style={{ fontSize: 13, fontWeight: 800, color }}>
            {report.confidence}% <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>({report.confidenceLabel})</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {meterBars}
        </div>
      </div>

      {/* Accuracy tracking (Phase 6 Backtest validity badge) */}
      {accuracyStats && accuracyStats.evaluatedCount > 0 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', padding: '8px 12px',
          background: 'rgba(255,255,255,0.02)', borderRadius: 8, fontSize: 11,
          border: '1px solid rgba(255,255,255,0.04)', marginBottom: 16
        }}>
          <span style={{ color: 'var(--muted)' }}>🎯 Model Backtest Accuracy:</span>
          <strong style={{ color: '#e5e7eb' }}>
            {accuracyStats.overallAccuracy}% <span style={{ fontWeight: 400, color: 'var(--muted)' }}>({accuracyStats.evaluatedCount} signals)</span>
          </strong>
        </div>
      )}

      {/* Summary message */}
      <p style={{ margin: '0 0 16px 0', fontSize: 12.5, lineHeight: 1.45, color: '#9ca3af' }}>
        {explanation ? explanation.summary.split('. ')[0] + '.' : 'Calculation succeeded.'}
      </p>

      {/* Primary Actions */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={() => setIsModalOpen(true)} className="secondary" style={{
          flex: 1, padding: '8px 0', fontSize: 12, borderRadius: 8, height: 36,
          fontWeight: 600, border: '1px solid rgba(99,102,241,0.3)', color: '#a78bfa'
        }}>
          🔍 See Full Reasoning Chain
        </button>
      </div>

      {/* Explainability Details Modal */}
      <ReasoningModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        explanation={explanation}
      />
    </div>
  );
}
