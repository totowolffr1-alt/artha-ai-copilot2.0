/**
 * AuthGate.tsx
 * Biometric auth lock screen using WebAuthn (fingerprint / Face ID).
 * Falls back to a SHA-256 hashed PIN. 15-minute session timeout.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

const SESSION_KEY  = 'artha_session_ts';
const PIN_HASH_KEY = 'artha_pin_hash';
const CRED_ID_KEY  = 'artha_cred_id';
const SESSION_TTL  = 15 * 60 * 1000; // 15 minutes

// ── SHA-256 helper ────────────────────────────────────────────────────────────
async function sha256(text: string): Promise<string> {
  const buf  = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── WebAuthn helpers ──────────────────────────────────────────────────────────
function webAuthnSupported(): boolean {
  return !!(window.PublicKeyCredential && navigator.credentials?.create);
}

async function registerBiometric(): Promise<string | null> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Artha AI Copilot', id: window.location.hostname },
        user: {
          id: new TextEncoder().encode('artha-user'),
          name: 'artha@copilot',
          displayName: 'Artha User',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7  }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        timeout: 60000,
        attestation: 'none',
      },
    }) as PublicKeyCredential | null;

    if (!cred) return null;
    return btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
  } catch {
    return null;
  }
}

async function verifyBiometric(credIdB64: string): Promise<boolean> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const rawId = Uint8Array.from(atob(credIdB64), c => c.charCodeAt(0));

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: rawId, transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

// ── Session helpers ───────────────────────────────────────────────────────────
function isSessionValid(): boolean {
  const ts = localStorage.getItem(SESSION_KEY);
  if (!ts) return false;
  return Date.now() - parseInt(ts, 10) < SESSION_TTL;
}

function grantSession() {
  localStorage.setItem(SESSION_KEY, String(Date.now()));
}

function revokeSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ── Main Component ────────────────────────────────────────────────────────────
interface AuthGateProps {
  children: React.ReactNode;
}

type Screen = 'checking' | 'locked' | 'setup-pin' | 'enter-pin' | 'unlocked';

export function AuthGate({ children }: AuthGateProps) {
  const [screen, setScreen]         = useState<Screen>('checking');
  const [pin, setPin]               = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError]     = useState('');
  const [biometricAvail, setBiometricAvail] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [setupStep, setSetupStep]   = useState<'choice' | 'pin-entry' | 'pin-confirm'>('choice');
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset session timer on any activity
  const resetTimer = useCallback(() => {
    if (screen !== 'unlocked') return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      revokeSession();
      setScreen('locked');
      setPin('');
    }, SESSION_TTL);
    grantSession(); // extend timestamp
  }, [screen]);

  useEffect(() => {
    if (screen !== 'unlocked') return;
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      clearTimeout(timeoutRef.current);
    };
  }, [screen, resetTimer]);

  // Initial check
  useEffect(() => {
    const hasPinHash = !!localStorage.getItem(PIN_HASH_KEY);
    const hasCredId  = !!localStorage.getItem(CRED_ID_KEY);

    setBiometricAvail(webAuthnSupported());

    if (isSessionValid()) {
      setScreen('unlocked');
      return;
    }

    if (!hasPinHash && !hasCredId) {
      setScreen('setup-pin'); // First time — need to set up auth
    } else {
      setScreen('locked');
    }
  }, []);

  // ── Biometric login ───────────────────────────────────────────────────────
  async function handleBiometricUnlock() {
    const credId = localStorage.getItem(CRED_ID_KEY);
    if (!credId) return;
    setBiometricLoading(true);
    try {
      const ok = await verifyBiometric(credId);
      if (ok) { grantSession(); setScreen('unlocked'); }
      else setPinError('Biometric verification failed. Try PIN instead.');
    } catch {
      setPinError('Biometric error. Use PIN instead.');
    } finally {
      setBiometricLoading(false);
    }
  }

  // ── Biometric registration ────────────────────────────────────────────────
  async function handleBiometricSetup() {
    setBiometricLoading(true);
    try {
      const credId = await registerBiometric();
      if (credId) {
        localStorage.setItem(CRED_ID_KEY, credId);
        grantSession();
        setScreen('unlocked');
      } else {
        setSetupStep('pin-entry'); // fall back to PIN
      }
    } finally {
      setBiometricLoading(false);
    }
  }

  // ── PIN setup ─────────────────────────────────────────────────────────────
  async function handlePinConfirm() {
    if (pin.length < 4) { setPinError('PIN must be at least 4 digits'); return; }
    if (pin !== confirmPin) { setPinError('PINs do not match'); return; }
    const hash = await sha256(pin);
    localStorage.setItem(PIN_HASH_KEY, hash);
    grantSession();
    setScreen('unlocked');
  }

  // ── PIN unlock ────────────────────────────────────────────────────────────
  async function handlePinUnlock() {
    const stored = localStorage.getItem(PIN_HASH_KEY);
    if (!stored) { setPinError('No PIN set. Please reload.'); return; }
    const hash = await sha256(pin);
    if (hash === stored) { grantSession(); setScreen('unlocked'); setPin(''); }
    else { setPinError('Incorrect PIN. Try again.'); setPin(''); }
  }

  // ── PIN input handler ─────────────────────────────────────────────────────
  function handlePinInput(digit: string) {
    setPinError('');
    if (digit === 'DEL') {
      setPin(p => p.slice(0, -1));
    } else if (pin.length < 6) {
      setPin(p => p + digit);
    }
  }

  function handleConfirmInput(digit: string) {
    setPinError('');
    if (digit === 'DEL') setConfirmPin(p => p.slice(0, -1));
    else if (confirmPin.length < 6) setConfirmPin(p => p + digit);
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const OVERLAY: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'linear-gradient(135deg, #060b18 0%, #0f0826 50%, #060b18 100%)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: 24, fontFamily: "'Inter', system-ui, sans-serif",
  };
  const CARD_STYLE: React.CSSProperties = {
    width: '100%', maxWidth: 360,
    background: 'rgba(17,24,39,0.95)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: 20, padding: '32px 28px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
    backdropFilter: 'blur(20px)',
  };
  const PIN_DOT = (filled: boolean): React.CSSProperties => ({
    width: 14, height: 14, borderRadius: '50%',
    background: filled ? '#6366f1' : 'rgba(255,255,255,0.12)',
    border: `2px solid ${filled ? '#6366f1' : 'rgba(255,255,255,0.2)'}`,
    transition: 'all 0.15s',
    boxShadow: filled ? '0 0 8px rgba(99,102,241,0.6)' : 'none',
  });
  const NUMPAD_BTN = (label: string): React.CSSProperties => ({
    width: 70, height: 70, borderRadius: '50%',
    background: label === 'DEL' ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.06)',
    border: `1px solid ${label === 'DEL' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)'}`,
    color: label === 'DEL' ? '#f87171' : '#e0e7ff',
    fontSize: label === 'DEL' ? 13 : 22, fontWeight: 600,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.1s',
  });

  // ── Checking ──────────────────────────────────────────────────────────────
  if (screen === 'checking') return (
    <div style={OVERLAY}>
      <div style={{ color: 'var(--muted)', fontSize: 14 }}>🔐 Checking session…</div>
    </div>
  );

  // ── Unlocked ──────────────────────────────────────────────────────────────
  if (screen === 'unlocked') return <>{children}</>;

  // ── Lock screen ───────────────────────────────────────────────────────────
  if (screen === 'locked') {
    const credId = localStorage.getItem(CRED_ID_KEY);
    return (
      <div style={OVERLAY}>
        {/* Logo */}
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>⚡</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>Artha AI</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Your session has expired</div>
        </div>

        <div style={CARD_STYLE}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 6 }}>🔒 Unlock to continue</div>
          </div>

          {/* Biometric button */}
          {biometricAvail && credId && (
            <button onClick={handleBiometricUnlock} disabled={biometricLoading}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 12, marginBottom: 12,
                background: 'linear-gradient(135deg,#4f46e5,#6366f1)',
                border: 'none', color: '#fff', fontSize: 16, fontWeight: 700,
                cursor: biometricLoading ? 'wait' : 'pointer',
                boxShadow: '0 4px 20px rgba(99,102,241,0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
              {biometricLoading ? '⏳ Verifying…' : '👆 Use Fingerprint / Face ID'}
            </button>
          )}

          {/* PIN fallback */}
          <button onClick={() => { setScreen('enter-pin'); setPin(''); setPinError(''); }}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 12,
              background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--muted)', fontSize: 14, cursor: 'pointer',
            }}>
            🔢 Enter PIN instead
          </button>

          {pinError && <div style={{ marginTop: 12, fontSize: 13, color: '#f87171', textAlign: 'center' }}>{pinError}</div>}
        </div>
      </div>
    );
  }

  // ── Enter PIN ─────────────────────────────────────────────────────────────
  if (screen === 'enter-pin') {
    return (
      <div style={OVERLAY}>
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>⚡</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Artha AI</div>
        </div>

        <div style={CARD_STYLE}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#e0e7ff', marginBottom: 16 }}>🔢 Enter your PIN</div>
            {/* PIN dots */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 6 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={PIN_DOT(i < pin.length)} />
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{pin.length}/6 digits</div>
          </div>

          {/* Numpad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, justifyItems: 'center', marginBottom: 16 }}>
            {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((d, i) => (
              d === '' ? <div key={i} /> :
              <button key={d} onClick={() => handlePinInput(d)}
                style={NUMPAD_BTN(d)}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.05)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}>
                {d}
              </button>
            ))}
          </div>

          <button onClick={handlePinUnlock} disabled={pin.length < 4}
            style={{
              width: '100%', padding: '13px 0', borderRadius: 12,
              background: pin.length >= 4 ? 'linear-gradient(135deg,#4f46e5,#6366f1)' : 'rgba(255,255,255,0.05)',
              border: 'none', color: pin.length >= 4 ? '#fff' : 'var(--muted)',
              fontSize: 15, fontWeight: 700, cursor: pin.length >= 4 ? 'pointer' : 'not-allowed',
              boxShadow: pin.length >= 4 ? '0 4px 16px rgba(99,102,241,0.3)' : 'none',
            }}>
            Unlock →
          </button>

          {pinError && <div style={{ marginTop: 10, fontSize: 13, color: '#f87171', textAlign: 'center' }}>{pinError}</div>}
          <button onClick={() => setScreen('locked')}
            style={{ marginTop: 12, width: '100%', padding: '8px', background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // ── First-time Setup ──────────────────────────────────────────────────────
  return (
    <div style={OVERLAY}>
      <div style={{ marginBottom: 28, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 6 }}>⚡</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>Artha AI</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Set up your security lock</div>
      </div>

      <div style={CARD_STYLE}>
        {setupStep === 'choice' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e0e7ff', marginBottom: 6, textAlign: 'center' }}>🔐 Protect your account</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', marginBottom: 24 }}>
              Choose how to secure Artha AI on this device
            </div>

            {biometricAvail && (
              <button onClick={handleBiometricSetup} disabled={biometricLoading}
                style={{
                  width: '100%', padding: '14px', borderRadius: 12, marginBottom: 12,
                  background: 'linear-gradient(135deg,#4f46e5,#6366f1)',
                  border: 'none', color: '#fff', fontSize: 15, fontWeight: 700,
                  cursor: biometricLoading ? 'wait' : 'pointer',
                  boxShadow: '0 4px 20px rgba(99,102,241,0.35)',
                  textAlign: 'center',
                }}>
                {biometricLoading ? '⏳ Setting up…' : '👆 Use Fingerprint / Face ID'}
              </button>
            )}

            <button onClick={() => setSetupStep('pin-entry')}
              style={{
                width: '100%', padding: '12px', borderRadius: 12,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#e0e7ff', fontSize: 14, cursor: 'pointer', fontWeight: 600,
              }}>
              🔢 Set up PIN instead
            </button>

            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
              Session auto-locks after 15 minutes of inactivity
            </div>
          </>
        )}

        {setupStep === 'pin-entry' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#e0e7ff', marginBottom: 14 }}>
                🔢 Create a PIN (4–6 digits)
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 6 }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={PIN_DOT(i < pin.length)} />
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{pin.length}/6</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, justifyItems: 'center', marginBottom: 16 }}>
              {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((d, i) => (
                d === '' ? <div key={i} /> :
                <button key={d} onClick={() => handlePinInput(d)} style={NUMPAD_BTN(d)}>
                  {d}
                </button>
              ))}
            </div>

            <button onClick={() => { if (pin.length >= 4) setSetupStep('pin-confirm'); }}
              disabled={pin.length < 4}
              style={{
                width: '100%', padding: '13px 0', borderRadius: 12,
                background: pin.length >= 4 ? 'linear-gradient(135deg,#4f46e5,#6366f1)' : 'rgba(255,255,255,0.05)',
                border: 'none', color: pin.length >= 4 ? '#fff' : 'var(--muted)',
                fontSize: 15, fontWeight: 700, cursor: pin.length >= 4 ? 'pointer' : 'not-allowed',
              }}>
              Next →
            </button>
            {pinError && <div style={{ marginTop: 10, fontSize: 13, color: '#f87171', textAlign: 'center' }}>{pinError}</div>}
          </>
        )}

        {setupStep === 'pin-confirm' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#e0e7ff', marginBottom: 14 }}>
                ✅ Confirm PIN
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 6 }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={PIN_DOT(i < confirmPin.length)} />
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{confirmPin.length}/6</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, justifyItems: 'center', marginBottom: 16 }}>
              {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((d, i) => (
                d === '' ? <div key={i} /> :
                <button key={d} onClick={() => handleConfirmInput(d)} style={NUMPAD_BTN(d)}>
                  {d}
                </button>
              ))}
            </div>

            <button onClick={handlePinConfirm} disabled={confirmPin.length < 4}
              style={{
                width: '100%', padding: '13px 0', borderRadius: 12,
                background: confirmPin.length >= 4 ? 'linear-gradient(135deg,#059669,#10b981)' : 'rgba(255,255,255,0.05)',
                border: 'none', color: confirmPin.length >= 4 ? '#fff' : 'var(--muted)',
                fontSize: 15, fontWeight: 700, cursor: confirmPin.length >= 4 ? 'pointer' : 'not-allowed',
                boxShadow: confirmPin.length >= 4 ? '0 4px 16px rgba(16,185,129,0.3)' : 'none',
              }}>
              ✅ Set PIN &amp; Unlock
            </button>
            {pinError && <div style={{ marginTop: 10, fontSize: 13, color: '#f87171', textAlign: 'center' }}>{pinError}</div>}
            <button onClick={() => { setSetupStep('pin-entry'); setPin(''); setConfirmPin(''); setPinError(''); }}
              style={{ marginTop: 10, width: '100%', padding: '8px', background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
