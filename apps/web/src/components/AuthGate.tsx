/**
 * AuthGate.tsx  — STRICT MODE
 *
 * Rules:
 *  1. Auth required on EVERY page load / refresh / new tab (sessionStorage — not persistent).
 *  2. If biometric is enrolled, it auto-triggers immediately on mount.
 *  3. Once PIN or biometric is set up, it CANNOT be changed from inside the app.
 *  4. No skip. No back. No bypass.
 */
import { useState, useEffect, useRef } from 'react';

// ── Storage keys (PIN hash + credential ID live in localStorage forever) ──────
const PIN_HASH_KEY  = 'artha_pin_hash';
const CRED_ID_KEY   = 'artha_cred_id';
const SESSION_KEY   = 'artha_session';   // sessionStorage → cleared on every reload/tab close

// ── SHA-256 ───────────────────────────────────────────────────────────────────
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
          id: new TextEncoder().encode('artha-owner'),
          name: 'artha@copilot',
          displayName: 'Artha Owner',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7   }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',  // device built-in only
          userVerification: 'required',          // fingerprint / Face ID mandatory
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

// ── Session (tab-scoped) ──────────────────────────────────────────────────────
function isUnlocked(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === 'true';
}
function grantSession() {
  sessionStorage.setItem(SESSION_KEY, 'true');
}

// ── Is the app already configured? ───────────────────────────────────────────
function isConfigured(): boolean {
  return !!(localStorage.getItem(PIN_HASH_KEY) || localStorage.getItem(CRED_ID_KEY));
}

// ── UI helpers ────────────────────────────────────────────────────────────────
const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9999,
  background: 'linear-gradient(135deg, #04080f 0%, #0b0620 50%, #04080f 100%)',
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  padding: 20,
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
};

const CARD: React.CSSProperties = {
  width: '100%', maxWidth: 360,
  background: 'rgba(13, 18, 30, 0.97)',
  border: '1px solid rgba(99, 102, 241, 0.3)',
  borderRadius: 22,
  padding: '32px 26px',
  boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.1)',
  backdropFilter: 'blur(20px)',
};

const PIN_DOT_STYLE = (filled: boolean): React.CSSProperties => ({
  width: 15, height: 15, borderRadius: '50%',
  background: filled ? '#6366f1' : 'rgba(255,255,255,0.1)',
  border: `2px solid ${filled ? '#818cf8' : 'rgba(255,255,255,0.18)'}`,
  transition: 'all 0.15s cubic-bezier(.34,1.56,.64,1)',
  transform: filled ? 'scale(1.15)' : 'scale(1)',
  boxShadow: filled ? '0 0 12px rgba(99,102,241,0.7)' : 'none',
});

const NUMPAD_BTN_STYLE = (label: string): React.CSSProperties => ({
  width: 72, height: 72, borderRadius: '50%',
  background: label === 'DEL' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.05)',
  border: `1px solid ${label === 'DEL' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.09)'}`,
  color: label === 'DEL' ? '#f87171' : '#e0e7ff',
  fontSize: label === 'DEL' ? 14 : 22,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'all 0.12s',
  userSelect: 'none',
});

// ── Main Component ────────────────────────────────────────────────────────────
type Screen =
  | 'checking'
  | 'unlocked'
  | 'lock-biometric'   // show fingerprint prompt
  | 'lock-pin'         // show PIN numpad
  | 'setup-choice'     // first-time: biometric or PIN?
  | 'setup-pin-enter'
  | 'setup-pin-confirm';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [screen, setScreen]         = useState<Screen>('checking');
  const [pin, setPin]               = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError]           = useState('');
  const [biometricAvail, setBiometricAvail] = useState(false);
  const [busy, setBusy]             = useState(false);
  const [shake, setShake]           = useState(false);
  const autoTriggered = useRef(false);

  // ── Boot ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const hasBiometric = !!localStorage.getItem(CRED_ID_KEY);
    const hasPin       = !!localStorage.getItem(PIN_HASH_KEY);
    const bioSupport   = webAuthnSupported();

    setBiometricAvail(bioSupport);

    if (isUnlocked()) {
      setScreen('unlocked');
      return;
    }

    if (!isConfigured()) {
      setScreen('setup-choice');
    } else if (hasBiometric) {
      setScreen('lock-biometric');
    } else if (hasPin) {
      setScreen('lock-pin');
    }
  }, []);

  // ── Auto-trigger biometric on lock screen ───────────────────────────────────
  useEffect(() => {
    if (screen === 'lock-biometric' && !autoTriggered.current) {
      autoTriggered.current = true;
      // Small delay so UI renders first
      setTimeout(() => triggerBiometricVerify(), 400);
    }
  }, [screen]);

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }

  // ── Biometric verify ────────────────────────────────────────────────────────
  async function triggerBiometricVerify() {
    const credId = localStorage.getItem(CRED_ID_KEY);
    if (!credId || busy) return;
    setBusy(true);
    setError('');
    try {
      const ok = await verifyBiometric(credId);
      if (ok) {
        grantSession();
        setScreen('unlocked');
      } else {
        setError('Biometric not recognised. Try again or use PIN.');
        triggerShake();
      }
    } catch {
      setError('Biometric failed. Use PIN fallback below.');
    } finally {
      setBusy(false);
    }
  }

  // ── Biometric register (setup) ───────────────────────────────────────────────
  async function triggerBiometricSetup() {
    setBusy(true);
    setError('');
    try {
      const credId = await registerBiometric();
      if (credId) {
        localStorage.setItem(CRED_ID_KEY, credId);
        grantSession();
        setScreen('unlocked');
      } else {
        setError('Biometric setup failed or cancelled. Set a PIN instead.');
        setScreen('setup-pin-enter');
      }
    } finally {
      setBusy(false);
    }
  }

  // ── PIN unlock ───────────────────────────────────────────────────────────────
  async function handlePinUnlock() {
    const stored = localStorage.getItem(PIN_HASH_KEY);
    if (!stored || !pin) return;
    setBusy(true);
    try {
      const hash = await sha256(pin);
      if (hash === stored) {
        grantSession();
        setScreen('unlocked');
        setPin('');
      } else {
        triggerShake();
        setError('Incorrect PIN');
        setPin('');
      }
    } finally {
      setBusy(false);
    }
  }

  // ── PIN setup confirm ────────────────────────────────────────────────────────
  async function handlePinSetupConfirm() {
    if (pin !== confirmPin) {
      setError('PINs do not match');
      triggerShake();
      setConfirmPin('');
      return;
    }
    setBusy(true);
    try {
      const hash = await sha256(pin);
      localStorage.setItem(PIN_HASH_KEY, hash);
      grantSession();
      setScreen('unlocked');
    } finally {
      setBusy(false);
    }
  }

  // ── Numpad ───────────────────────────────────────────────────────────────────
  function pressDigit(setter: React.Dispatch<React.SetStateAction<string>>, current: string, digit: string) {
    setError('');
    if (digit === 'DEL') { setter(current.slice(0, -1)); return; }
    if (current.length < 6) setter(current + digit);
  }

  function Numpad({ value, onChange, onSubmit, submitLabel = 'Unlock →' }: {
    value: string;
    onChange: (d: string) => void;
    onSubmit: () => void;
    submitLabel?: string;
  }) {
    return (
      <>
        {/* PIN dots */}
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginBottom: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={PIN_DOT_STYLE(i < value.length)} />
          ))}
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', marginBottom: 22 }}>
          {value.length}/6 digits
        </div>

        {/* Numpad grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, justifyItems: 'center', marginBottom: 18 }}>
          {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((d, i) =>
            d === '' ? <div key={i} style={{ width: 72, height: 72 }} /> :
            <button
              key={d}
              onClick={() => onChange(d)}
              style={NUMPAD_BTN_STYLE(d)}
              onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.92)'; (e.currentTarget as HTMLButtonElement).style.background = d === 'DEL' ? 'rgba(239,68,68,0.18)' : 'rgba(99,102,241,0.15)'; }}
              onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLButtonElement).style.background = d === 'DEL' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.05)'; }}
              onTouchStart={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.92)'; }}
              onTouchEnd={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
            >
              {d}
            </button>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={onSubmit}
          disabled={value.length < 4 || busy}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 13, border: 'none',
            background: value.length >= 4 ? 'linear-gradient(135deg, #4f46e5, #6366f1)' : 'rgba(255,255,255,0.05)',
            color: value.length >= 4 ? '#fff' : 'rgba(255,255,255,0.2)',
            fontSize: 16, fontWeight: 700,
            cursor: value.length >= 4 ? 'pointer' : 'not-allowed',
            boxShadow: value.length >= 4 ? '0 4px 20px rgba(99,102,241,0.4)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          {busy ? '⏳ Verifying…' : submitLabel}
        </button>
      </>
    );
  }

  const logoBlock = (
    <div style={{ marginBottom: 30, textAlign: 'center' }}>
      <div style={{ fontSize: 52, marginBottom: 6, filter: 'drop-shadow(0 0 20px rgba(99,102,241,0.6))' }}>⚡</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>Artha AI</div>
      <div style={{ fontSize: 13, color: '#6366f1', marginTop: 3, fontWeight: 500 }}>Copilot — Secured</div>
    </div>
  );

  // ── Screens ──────────────────────────────────────────────────────────────────
  if (screen === 'checking') return (
    <div style={OVERLAY}>
      <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>🔐 Initialising…</div>
    </div>
  );

  if (screen === 'unlocked') return <>{children}</>;

  // ── Biometric lock screen ────────────────────────────────────────────────────
  if (screen === 'lock-biometric') return (
    <div style={OVERLAY}>
      {logoBlock}
      <div style={{
        ...CARD,
        transform: shake ? 'translateX(0)' : 'translateX(0)',
        animation: shake ? 'shake 0.4s ease' : 'none',
      }}>
        <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }`}</style>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', margin: '0 auto 14px',
            background: busy ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
            border: `2px solid ${busy ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32,
            boxShadow: busy ? '0 0 24px rgba(99,102,241,0.5)' : 'none',
            transition: 'all 0.3s',
          }}>
            {busy ? '⏳' : '👆'}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
            {busy ? 'Verifying…' : 'Touch to Unlock'}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            {busy ? 'Place your finger on the sensor' : 'Use your fingerprint or Face ID'}
          </div>
        </div>

        {/* Retry biometric */}
        {!busy && (
          <button onClick={triggerBiometricVerify} style={{
            width: '100%', padding: '14px 0', borderRadius: 13, border: 'none',
            background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
            color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginBottom: 12,
          }}>
            👆 Verify Biometric
          </button>
        )}

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 12,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: 13, textAlign: 'center' }}>
            {error}
          </div>
        )}

        {/* PIN fallback — only shown after error */}
        {error && localStorage.getItem(PIN_HASH_KEY) && (
          <button onClick={() => { setError(''); setPin(''); setScreen('lock-pin'); }} style={{
            width: '100%', padding: '11px 0', borderRadius: 11,
            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer',
          }}>
            🔢 Use PIN instead
          </button>
        )}
      </div>
    </div>
  );

  // ── PIN lock screen ──────────────────────────────────────────────────────────
  if (screen === 'lock-pin') return (
    <div style={OVERLAY}>
      {logoBlock}
      <div style={{ ...CARD, animation: shake ? 'shake 0.4s ease' : 'none' }}>
        <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }`}</style>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e0e7ff', marginBottom: 4 }}>🔒 Enter PIN</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>This device is secured</div>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 14,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
            color: '#f87171', fontSize: 13, textAlign: 'center' }}>
            {error}
          </div>
        )}

        <Numpad
          value={pin}
          onChange={d => pressDigit(setPin, pin, d)}
          onSubmit={handlePinUnlock}
        />

        {/* Back to biometric if available */}
        {localStorage.getItem(CRED_ID_KEY) && (
          <button onClick={() => { setError(''); setPin(''); setScreen('lock-biometric'); autoTriggered.current = false; }} style={{
            marginTop: 12, width: '100%', padding: '10px', background: 'transparent',
            border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 13, cursor: 'pointer',
          }}>
            ← Use Biometric instead
          </button>
        )}
      </div>
    </div>
  );

  // ── First-time setup: choice ─────────────────────────────────────────────────
  if (screen === 'setup-choice') return (
    <div style={OVERLAY}>
      {logoBlock}
      <div style={CARD}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 6 }}>🔐 Secure your Copilot</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
            Choose your lock method.<br />
            <strong style={{ color: '#f87171' }}>This cannot be changed later without clearing browser data.</strong>
          </div>
        </div>

        {biometricAvail && (
          <button onClick={triggerBiometricSetup} disabled={busy} style={{
            width: '100%', padding: '15px', borderRadius: 13, border: 'none',
            background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
            color: '#fff', fontSize: 16, fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            boxShadow: '0 4px 24px rgba(99,102,241,0.4)',
            marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}>
            {busy ? '⏳ Setting up…' : '👆 Use Fingerprint / Face ID'}
          </button>
        )}

        <button onClick={() => setScreen('setup-pin-enter')} disabled={busy} style={{
          width: '100%', padding: '13px', borderRadius: 13,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          color: '#e0e7ff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
        }}>
          🔢 Set up PIN (4–6 digits)
        </button>

        <div style={{ marginTop: 16, padding: '10px 12px', borderRadius: 10,
          background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <div style={{ fontSize: 12, color: '#fbbf24', lineHeight: 1.6 }}>
            ⚠️ <strong>One-time setup.</strong> No one will be able to access Artha AI without your biometric or PIN. If you forget your PIN, you must clear your browser's site data to reset.
          </div>
        </div>
      </div>
    </div>
  );

  // ── First-time setup: PIN entry ───────────────────────────────────────────────
  if (screen === 'setup-pin-enter') return (
    <div style={OVERLAY}>
      {logoBlock}
      <div style={CARD}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e0e7ff', marginBottom: 4 }}>Create your PIN</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>4–6 digits · Remember this</div>
        </div>

        <Numpad
          value={pin}
          onChange={d => pressDigit(setPin, pin, d)}
          onSubmit={() => { if (pin.length >= 4) { setConfirmPin(''); setError(''); setScreen('setup-pin-confirm'); } }}
          submitLabel="Next →"
        />
      </div>
    </div>
  );

  // ── First-time setup: PIN confirm ─────────────────────────────────────────────
  if (screen === 'setup-pin-confirm') return (
    <div style={OVERLAY}>
      {logoBlock}
      <div style={{ ...CARD, animation: shake ? 'shake 0.4s ease' : 'none' }}>
        <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }`}</style>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e0e7ff', marginBottom: 4 }}>Confirm PIN</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Enter the same PIN again</div>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 14,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
            color: '#f87171', fontSize: 13, textAlign: 'center' }}>
            {error}
          </div>
        )}

        <Numpad
          value={confirmPin}
          onChange={d => pressDigit(setConfirmPin, confirmPin, d)}
          onSubmit={handlePinSetupConfirm}
          submitLabel="✅ Set PIN &amp; Unlock"
        />
      </div>
    </div>
  );

  return null;
}
