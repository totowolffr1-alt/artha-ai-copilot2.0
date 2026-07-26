/**
 * RiskDashboard.tsx
 * Real-time risk guardrails — daily P&L gauge, drawdown, circuit breaker, trade budget.
 */
import { useState, useEffect } from 'react';
import { getVaultStatus } from '../services/api';

interface RiskMetrics {
  dailyPnL: number;
  dailyLossLimit: number;
  circuitBreakerTripped: boolean;
  consecutiveLosses: number;
  allocatedCapital: number;
  deployedCapital: number;
  availableCapital: number;
  drawdownPct: number;
  remainingBudget: number;
  maxPositionSize: number;
  openTrades: number;
}

function GaugeBar({ value, max, color, bgColor }: { value: number; max: number; color: string; bgColor: string }) {
  const pct = Math.min(100, Math.abs(max) > 0 ? (Math.abs(value) / Math.abs(max)) * 100 : 0);
  return (
    <div style={{ height: 8, borderRadius: 4, background: bgColor, overflow: 'hidden', marginTop: 6 }}>
      <div style={{
        height: '100%', borderRadius: 4,
        width: `${pct}%`,
        background: color,
        transition: 'width 0.6s ease',
        boxShadow: `0 0 8px ${color}55`,
      }} />
    </div>
  );
}

export function RiskDashboard() {
  const [metrics, setMetrics] = useState<RiskMetrics>({
    dailyPnL: 0,
    dailyLossLimit: -500,
    circuitBreakerTripped: false,
    consecutiveLosses: 0,
    allocatedCapital: 0,
    deployedCapital: 0,
    availableCapital: 0,
    drawdownPct: 0,
    remainingBudget: 0,
    maxPositionSize: 0,
    openTrades: 0,
  });
  const [lastUpdated, setLastUpdated] = useState<string>('—');

  const fetchRisk = async () => {
    try {
      const data = await getVaultStatus();
      if (!data?.vault) return;
      const v = data.vault;
      const r = data.risk || {};

      const alloc    = v.allocatedCapital ?? 0;
      const deployed = v.deployedCapital  ?? 0;
      const avail    = v.availableCapital ?? 0;
      const dailyPnL = r.daily_pnl ?? 0;
      const limit    = r.daily_loss_limit ?? -500;
      const drawdownPct = alloc > 0 ? (dailyPnL / alloc) * 100 : 0;
      const remainingBudget = alloc + dailyPnL; // how much capital is still in play
      const maxPositionSize = avail * 0.3; // 30% of available per trade rule

      setMetrics({
        dailyPnL,
        dailyLossLimit: typeof limit === 'number' ? limit : -Math.abs(limit),
        circuitBreakerTripped: r.circuit_breaker_tripped ?? false,
        consecutiveLosses: r.consecutive_losses ?? 0,
        allocatedCapital: alloc,
        deployedCapital: deployed,
        availableCapital: avail,
        drawdownPct,
        remainingBudget,
        maxPositionSize,
        openTrades: deployed > 0 ? 1 : 0,
      });
      setLastUpdated(new Date().toLocaleTimeString('en-IN'));
    } catch {}
  };

  useEffect(() => {
    fetchRisk();
    const id = setInterval(fetchRisk, 5000);
    return () => clearInterval(id);
  }, []);

  const lossUsedPct = metrics.dailyLossLimit !== 0
    ? Math.min(100, (Math.abs(metrics.dailyPnL < 0 ? metrics.dailyPnL : 0) / Math.abs(metrics.dailyLossLimit)) * 100)
    : 0;

  const gaugeColor = lossUsedPct > 80 ? '#ef4444' : lossUsedPct > 50 ? '#f59e0b' : '#10b981';

  return (
    <div className="card" style={{
      padding: 24, marginBottom: 24,
      background: 'linear-gradient(135deg,rgba(17,24,39,0.97) 0%,rgba(30,12,48,0.5) 100%)',
      border: `1px solid ${metrics.circuitBreakerTripped ? 'rgba(239,68,68,0.5)' : 'rgba(139,92,246,0.25)'}`,
      borderRadius: 16,
      boxShadow: metrics.circuitBreakerTripped ? '0 0 24px rgba(239,68,68,0.2)' : 'none',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🛡️ Risk Dashboard</span>
          {metrics.circuitBreakerTripped && (
            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)', animation: 'pulse 1s infinite' }}>
              ⚠️ CIRCUIT BREAKER TRIPPED
            </span>
          )}
        </h3>
        <span style={{ fontSize: 11, color: 'var(--muted)', background: 'rgba(255,255,255,0.04)', padding: '4px 10px', borderRadius: 8 }}>
          Updated {lastUpdated}
        </span>
      </div>

      {/* Daily Loss Gauge — the most critical metric */}
      <div style={{ marginBottom: 20, padding: '14px 16px', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>DAILY LOSS LIMIT</span>
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: gaugeColor, fontWeight: 700 }}>
            {lossUsedPct.toFixed(1)}% used
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
          <span>Today: <span style={{ color: metrics.dailyPnL >= 0 ? '#34d399' : '#f87171', fontFamily: 'monospace' }}>
            {metrics.dailyPnL >= 0 ? '+' : ''}₹{metrics.dailyPnL.toFixed(2)}
          </span></span>
          <span>Limit: <span style={{ fontFamily: 'monospace', color: '#f87171' }}>₹{metrics.dailyLossLimit.toFixed(0)}</span></span>
        </div>
        <GaugeBar value={metrics.dailyPnL < 0 ? metrics.dailyPnL : 0} max={metrics.dailyLossLimit} color={gaugeColor} bgColor="rgba(255,255,255,0.06)" />
        {lossUsedPct > 80 && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#fbbf24' }}>
            ⚠️ Approaching daily loss limit — copilot will halt new trades at 100%
          </div>
        )}
      </div>

      {/* Risk Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
        {/* Drawdown */}
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Portfolio Drawdown</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: metrics.drawdownPct < -3 ? '#f87171' : metrics.drawdownPct < -1 ? '#fbbf24' : '#34d399' }}>
            {metrics.drawdownPct >= 0 ? '+' : ''}{metrics.drawdownPct.toFixed(2)}%
          </div>
          <GaugeBar value={metrics.drawdownPct} max={-5} color={metrics.drawdownPct < -3 ? '#ef4444' : '#fbbf24'} bgColor="rgba(255,255,255,0.05)" />
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Max allowed: -5%</div>
        </div>

        {/* Consecutive Losses */}
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Consecutive Losses</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: metrics.consecutiveLosses >= 3 ? '#f87171' : metrics.consecutiveLosses >= 2 ? '#fbbf24' : '#34d399' }}>
            {metrics.consecutiveLosses}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Circuit trips at 3</div>
        </div>

        {/* Max Position Size */}
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Max Position Size</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#60a5fa' }}>
            ₹{metrics.maxPositionSize.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>30% of free capital</div>
        </div>

        {/* Capital Deployed */}
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Capital Deployed</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#fbbf24' }}>
            ₹{metrics.deployedCapital.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <GaugeBar value={metrics.deployedCapital} max={metrics.allocatedCapital || 1} color="#f59e0b" bgColor="rgba(255,255,255,0.05)" />
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>of ₹{metrics.allocatedCapital.toLocaleString('en-IN', { maximumFractionDigits: 0 })} allocated</div>
        </div>
      </div>

      {/* Status Pills Row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
          background: metrics.circuitBreakerTripped ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.12)',
          color: metrics.circuitBreakerTripped ? '#f87171' : '#34d399',
          border: `1px solid ${metrics.circuitBreakerTripped ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.2)'}`,
        }}>
          {metrics.circuitBreakerTripped ? '🔴 Circuit Breaker: TRIPPED' : '🟢 Circuit Breaker: OK'}
        </span>
        <span style={{
          padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
          background: 'rgba(99,102,241,0.1)', color: '#a5b4fc',
          border: '1px solid rgba(99,102,241,0.2)',
        }}>
          📐 Kelly Sizing: 25% max
        </span>
        <span style={{
          padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
          background: 'rgba(245,158,11,0.1)', color: '#fbbf24',
          border: '1px solid rgba(245,158,11,0.2)',
        }}>
          🎯 Risk/Reward: 1:2 min
        </span>
      </div>
    </div>
  );
}
