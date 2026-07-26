import React, { useState, useEffect } from 'react';
import { getVaultStatus, allocateCapital, deallocateCapital } from '../services/api';

export function CapitalVaultCard() {
  const [vaultData, setVaultData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [inputAmount, setInputAmount] = useState<string>('1000');
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchVault = async () => {
    try {
      const data = await getVaultStatus();
      if (data && data.vault) {
        setVaultData(data);
      }
    } catch (err) {
      console.error('Failed to fetch vault status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVault();
    const interval = setInterval(fetchVault, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAllocate = async (amountToAllot?: number) => {
    const val = amountToAllot || parseFloat(inputAmount);
    if (isNaN(val) || val <= 0) {
      setActionMessage({ text: 'Please enter a valid capital amount', type: 'error' });
      return;
    }
    setIsSubmitting(true);
    setActionMessage(null);
    try {
      const res = await allocateCapital(val);
      if (res.message || res.vault) {
        setActionMessage({ text: `✅ ${res.message || `Successfully allotted ₹${val.toLocaleString('en-IN')}!`}`, type: 'success' });
        fetchVault();
      } else {
        setActionMessage({ text: `❌ ${res.error || 'Allocation failed'}`, type: 'error' });
      }
    } catch (err: any) {
      setActionMessage({ text: `❌ ${err.message}`, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeallocate = async () => {
    const val = parseFloat(inputAmount);
    if (isNaN(val) || val <= 0) {
      setActionMessage({ text: 'Please enter a valid amount to release', type: 'error' });
      return;
    }
    setIsSubmitting(true);
    setActionMessage(null);
    try {
      const res = await deallocateCapital(val);
      if (res.message || res.vault) {
        setActionMessage({ text: `✅ ${res.message || `Released ₹${val.toLocaleString('en-IN')} from Vault`}`, type: 'success' });
        fetchVault();
      } else {
        setActionMessage({ text: `❌ ${res.error || 'Deallocation failed'}`, type: 'error' });
      }
    } catch (err: any) {
      setActionMessage({ text: `❌ ${err.message}`, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading && !vaultData) {
    return (
      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading Capital Vault status...</div>
      </div>
    );
  }

  const vault = vaultData?.vault || {
    allocatedCapital: 0,
    deployedCapital: 0,
    availableCapital: 0,
    totalPnL: 0,
    state: 'ACTIVE',
    mode: 'PAPER',
    compoundMode: false,
  };

  const risk = vaultData?.risk || {
    circuit_breaker_tripped: false,
    daily_pnl: 0,
  };

  const isLowCapital = (vault.allocatedCapital ?? 0) < 2000;

  return (
    <div className="card" style={{
      padding: 24,
      marginBottom: 24,
      background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.95) 0%, rgba(30, 27, 75, 0.4) 100%)',
      border: '1px solid rgba(99, 102, 241, 0.3)',
      boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      borderRadius: 16,
    }}>
      {/* Header Title & Badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>🤖 Quant Employee — Capital Vault</span>
            <span style={{
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 20,
              fontWeight: 600,
              background: risk.circuit_breaker_tripped ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
              color: risk.circuit_breaker_tripped ? '#ef4444' : '#34d399',
              border: `1px solid ${risk.circuit_breaker_tripped ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
            }}>
              {risk.circuit_breaker_tripped ? '🔴 CIRCUIT BREAKER TRIPPED' : '🟢 ACTIVE & READY'}
            </span>
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Allot a block of money for your Copilot to trade autonomously with institutional risk rules.
          </p>
        </div>

        {/* Execution Mode Pill */}
        <div style={{
          padding: '8px 14px',
          borderRadius: 12,
          fontSize: 12,
          fontWeight: 600,
          background: isLowCapital ? 'rgba(245, 158, 11, 0.12)' : 'rgba(99, 102, 241, 0.15)',
          border: `1px solid ${isLowCapital ? 'rgba(245, 158, 11, 0.3)' : 'rgba(99, 102, 241, 0.4)'}`,
          color: isLowCapital ? '#fbbf24' : '#818cf8',
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}>
          <span>{isLowCapital ? '🛡️ PAPER EXECUTION (< ₹2,000)' : '⚡ LIVE ANGEL ONE EXECUTION'}</span>
        </div>
      </div>

      {/* Vault Balance Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Allotted Vault Capital</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#60a5fa', fontFamily: 'monospace' }}>
            ₹{(vault.allocatedCapital ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Locked by Manager</div>
        </div>

        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Available Free Capital</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#34d399', fontFamily: 'monospace' }}>
            ₹{(vault.availableCapital ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Ready for next trade</div>
        </div>

        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Active Position Capital</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fbbf24', fontFamily: 'monospace' }}>
            ₹{(vault.deployedCapital ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Deployed in market</div>
        </div>

        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Lifetime P&L</div>
          <div style={{
            fontSize: 24,
            fontWeight: 800,
            color: (vault.totalPnL ?? 0) >= 0 ? '#34d399' : '#f87171',
            fontFamily: 'monospace'
          }}>
            {(vault.totalPnL ?? 0) >= 0 ? '+' : ''}₹{(vault.totalPnL ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Auto-compounded</div>
        </div>
      </div>

      {/* Allotment Control Form */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.25)',
        padding: 16,
        borderRadius: 12,
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e7ff', marginBottom: 10 }}>
          💵 Manager Capital Allotment Control:
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 200px' }}>
            <span style={{ position: 'absolute', left: 12, top: 9, color: 'var(--muted)', fontSize: 14 }}>₹</span>
            <input
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="Enter amount (e.g. 100 or 5000)"
              style={{
                width: '100%',
                padding: '8px 12px 8px 28px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(15, 23, 42, 0.8)',
                color: '#fff',
                fontSize: 14,
                fontFamily: 'monospace'
              }}
            />
          </div>

          <button
            onClick={() => handleAllocate()}
            disabled={isSubmitting}
            style={{
              padding: '9px 18px',
              background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            {isSubmitting ? 'Processing…' : '➕ Allot Capital'}
          </button>

          <button
            onClick={handleDeallocate}
            disabled={isSubmitting}
            style={{
              padding: '9px 18px',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            ➖ Release Capital
          </button>
        </div>

        {/* Preset Quick Buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Quick Presets:</span>
          {[100, 500, 2000, 5000, 10000].map((preset) => (
            <button
              key={preset}
              onClick={() => {
                setInputAmount(preset.toString());
                handleAllocate(preset);
              }}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#cbd5e1',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'monospace'
              }}
            >
              +₹{preset >= 1000 ? `${preset / 1000}k` : preset}
            </button>
          ))}
        </div>

        {/* Action Status Feedback */}
        {actionMessage && (
          <div style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            background: actionMessage.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            border: `1px solid ${actionMessage.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            color: actionMessage.type === 'success' ? '#34d399' : '#f87171'
          }}>
            {actionMessage.text}
          </div>
        )}
      </div>
    </div>
  );
}
