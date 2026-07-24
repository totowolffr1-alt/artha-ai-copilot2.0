import { useState, useEffect, useCallback, useRef } from 'react';
import { initPushNotifications, disablePushNotifications, isPushEnabled } from '../services/pushManager';

const API = '/api/system';

/* ── Types ───────────────────────────────────────────────────────────────────── */
interface ServiceHealth {
  name: string; status: 'HEALTHY'|'WARNING'|'DEGRADED'|'CRITICAL';
  score: number; lastCheck: string; responseTimeMs: number;
  errorCount: number; uptime: number; message: string;
}
interface SystemHealth {
  overall: number; status: string;
  services: Record<string, ServiceHealth>; lastCheck: string; unreadNotifications: number;
}
interface Notification { id: number; timestamp: string; component: string; severity: string; title: string; message: string; cause?: string; suggested_fix?: string; read: boolean; }
interface TimelineEvent  { id: number; component: string; event: string; severity: string; details?: string; recorded_at: string; }
interface PriceAlert     { id: number; symbol: string; condition: 'ABOVE'|'BELOW'; target_price: number; active: boolean; triggered: boolean; created_at: string; }

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
const STATUS_COLOR: Record<string, string> = { HEALTHY:'#22c55e', WARNING:'#eab308', DEGRADED:'#f97316', CRITICAL:'#ef4444' };
const SEVERITY_COLOR: Record<string, string> = { INFO:'#22c55e', WARNING:'#eab308', HIGH:'#f97316', CRITICAL:'#ef4444' };
const SEVERITY_BG: Record<string, string> = { INFO:'rgba(34,197,94,0.12)', WARNING:'rgba(234,179,8,0.12)', HIGH:'rgba(249,115,22,0.12)', CRITICAL:'rgba(239,68,68,0.12)' };
const SERVICE_ICONS: Record<string, string> = {
  broker_api:'🔗', market_data:'📊', news_engine:'📰', ai_engine:'🤖',
  price_cache:'💾', backtesting:'🧪', risk_engine:'🛡️', safety_controller:'🚨',
  scheduler:'⏰', portfolio_engine:'💼',
};

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div style={{ background:'rgba(255,255,255,0.06)', borderRadius:4, height:6, overflow:'hidden', marginTop:6 }}>
      <div style={{ width:`${score}%`, background:color, height:'100%', borderRadius:4, transition:'width 0.8s ease' }} />
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  if (!points.length) return null;
  const max = 100; const min = 0; const w = 80; const h = 28;
  const xs = points.map((_, i) => (i / Math.max(points.length - 1, 1)) * w);
  const ys = points.map(p => h - ((p - min) / (max - min)) * h);
  const d  = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${ys[i]}`).join(' ');
  const last = points[points.length - 1] ?? 100;
  const col  = last >= 90 ? '#22c55e' : last >= 70 ? '#eab308' : last >= 50 ? '#f97316' : '#ef4444';
  return (
    <svg width={w} height={h} style={{ display:'block' }}>
      <path d={d} fill="none" stroke={col} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
    </svg>
  );
}

/* ── Service Card ─────────────────────────────────────────────────────────────── */
function ServiceCard({ name, svc, history, onRestart }: { name: string; svc: ServiceHealth; history: number[]; onRestart: (n:string)=>void }) {
  const color = STATUS_COLOR[svc.status] || '#6b7280';
  const label = name.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
  const icon  = SERVICE_ICONS[name] || '⚙️';
  const canRestart = ['broker_api','news_engine','price_cache'].includes(name);
  const actionMap: Record<string,string> = { broker_api:'retry_broker_auth', news_engine:'restart_news_worker', price_cache:'retry_price_cache' };

  return (
    <div style={{ background:'rgba(255,255,255,0.04)', border:`1px solid ${color}33`, borderRadius:12, padding:'16px 18px', transition:'transform 0.2s', cursor:'default' }}
         onMouseEnter={e => (e.currentTarget.style.transform='translateY(-2px)')}
         onMouseLeave={e => (e.currentTarget.style.transform='translateY(0)')}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:20 }}>{icon}</span>
          <span style={{ fontWeight:600, fontSize:13, color:'#e2e8f0' }}>{label}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ background:`${color}22`, color, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, letterSpacing:0.5 }}>{svc.status}</span>
          {canRestart && (
            <button onClick={() => onRestart(actionMap[name])}
              style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:6, padding:'2px 8px', fontSize:10, color:'#94a3b8', cursor:'pointer' }}>
              ⚡ Restart
            </button>
          )}
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
        <div>
          <div style={{ fontSize:28, fontWeight:800, color, lineHeight:1 }}>{svc.score}</div>
          <div style={{ fontSize:10, color:'#64748b', marginTop:2 }}>Health Score</div>
        </div>
        <Sparkline points={history} />
      </div>

      <ScoreBar score={svc.score} color={color} />

      <div style={{ marginTop:10, fontSize:11, color:'#94a3b8', lineHeight:1.5 }}>
        <div>{svc.message}</div>
        <div style={{ display:'flex', gap:12, marginTop:6, color:'#64748b' }}>
          <span>⏱ {svc.responseTimeMs}ms</span>
          <span>⚠️ {svc.errorCount} err</span>
          <span>🕐 {Math.floor(svc.uptime/60)}m up</span>
        </div>
      </div>
    </div>
  );
}

/* ── Gauge ────────────────────────────────────────────────────────────────────── */
function HealthGauge({ score }: { score: number }) {
  const r = 52; const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const col  = score >= 90 ? '#22c55e' : score >= 70 ? '#eab308' : score >= 50 ? '#f97316' : '#ef4444';
  return (
    <svg width={130} height={130} viewBox="0 0 130 130">
      <circle cx={65} cy={65} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} />
      <circle cx={65} cy={65} r={r} fill="none" stroke={col} strokeWidth={10}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 65 65)" style={{ transition:'stroke-dasharray 1s ease' }} />
      <text x={65} y={60} textAnchor="middle" fill={col} fontSize={24} fontWeight={800}>{score}</text>
      <text x={65} y={76} textAnchor="middle" fill="#64748b" fontSize={10}>Health %</text>
    </svg>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────────── */
export default function SystemHealth() {
  const [health,   setHealth]   = useState<SystemHealth | null>(null);
  const [notifs,   setNotifs]   = useState<Notification[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [alerts,   setAlerts]   = useState<PriceAlert[]>([]);
  const [history,  setHistory]  = useState<Record<string, number[]>>({});
  const [diagText, setDiagText] = useState('');
  const [pushOn,   setPushOn]   = useState(isPushEnabled());
  const [soundOn,  setSoundOn]  = useState(localStorage.getItem('sound_alerts') === 'true');
  const [loading,  setLoading]  = useState(true);
  const [diagLoading, setDiagLoading] = useState(false);
  const [activeTab,   setActiveTab]   = useState<'services'|'notifications'|'timeline'|'alerts'>('services');
  const [newAlert,    setNewAlert]    = useState({ symbol:'', condition:'ABOVE' as 'ABOVE'|'BELOW', target_price:'' });
  const audioRef = useRef<AudioContext | null>(null);
  const prevUnread = useRef(0);

  const beep = useCallback(() => {
    if (!soundOn) return;
    try {
      if (!audioRef.current) audioRef.current = new AudioContext();
      const o = audioRef.current.createOscillator();
      const g = audioRef.current.createGain();
      o.connect(g); g.connect(audioRef.current.destination);
      o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.3, audioRef.current.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioRef.current.currentTime + 0.4);
      o.start(); o.stop(audioRef.current.currentTime + 0.4);
    } catch {}
  }, [soundOn]);

  const fetchAll = useCallback(async () => {
    try {
      const [h, n, t, a] = await Promise.all([
        fetch(`${API}/health`).then(r => r.json()),
        fetch(`${API}/notifications?limit=50`).then(r => r.json()),
        fetch(`${API}/timeline?limit=100`).then(r => r.json()),
        fetch(`${API}/price-alerts`).then(r => r.json()),
      ]);
      setHealth(h);
      setNotifs(n.notifications || []);
      setTimeline(t.timeline || []);
      setAlerts(a.alerts || []);
      // Track sparkline history
      if (h.services) {
        setHistory(prev => {
          const next = { ...prev };
          Object.entries(h.services as Record<string, ServiceHealth>).forEach(([k, v]) => {
            const arr = next[k] || [];
            next[k] = [...arr.slice(-23), v.score];
          });
          return next;
        });
      }
      // Sound alert on new unread notifications
      const unread = n.unread || 0;
      if (unread > prevUnread.current) beep();
      prevUnread.current = unread;
    } catch {}
    finally { setLoading(false); }
  }, [beep]);

  useEffect(() => { fetchAll(); const t = setInterval(fetchAll, 10000); return () => clearInterval(t); }, [fetchAll]);

  const runDiagnostic = async () => {
    setDiagLoading(true);
    try {
      await fetch(`${API}/run-diagnostic`, { method:'POST' });
      const d = await fetch(`${API}/diagnostics`).then(r => r.json());
      setDiagText(d.report || '');
      await fetchAll();
    } finally { setDiagLoading(false); }
  };

  const restartService = async (serviceName: string, action: string) => {
    await fetch(`${API}/restart-service`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ service: serviceName, action }),
    });
    setTimeout(fetchAll, 2000);
  };

  const copyDiag = () => { navigator.clipboard.writeText(diagText).catch(() => {}); };

  const markAllRead = async () => {
    await fetch(`${API}/notifications/read`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ all:true }) });
    fetchAll();
  };

  const togglePush = async () => {
    if (pushOn) { await disablePushNotifications(); setPushOn(false); }
    else { const ok = await initPushNotifications(); setPushOn(ok); }
  };

  const toggleSound = () => {
    const next = !soundOn; setSoundOn(next);
    localStorage.setItem('sound_alerts', String(next));
  };

  const createAlert = async () => {
    if (!newAlert.symbol || !newAlert.target_price) return;
    await fetch(`${API}/price-alerts`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ symbol:newAlert.symbol.toUpperCase(), condition:newAlert.condition, target_price:parseFloat(newAlert.target_price) }),
    });
    setNewAlert({ symbol:'', condition:'ABOVE', target_price:'' });
    fetchAll();
  };

  const deleteAlert = async (id: number) => {
    await fetch(`${API}/price-alerts/${id}`, { method:'DELETE' });
    fetchAll();
  };

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', color:'#94a3b8', fontSize:14 }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:32, marginBottom:12, animation:'spin 1s linear infinite' }}>⚙️</div>
        <div>Loading system health...</div>
      </div>
    </div>
  );

  const services = health?.services || {};
  const unread   = notifs.filter(n => !n.read).length;

  return (
    <div style={{ padding:'24px 28px', maxWidth:1400, margin:'0 auto' }}>
      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:28, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:800, color:'#f1f5f9', margin:0 }}>⚙️ System Health</h1>
          <p style={{ color:'#64748b', fontSize:13, margin:'4px 0 0' }}>
            Last check: {health?.lastCheck ? new Date(health.lastCheck).toLocaleTimeString('en-IN', { timeZone:'Asia/Kolkata' }) : '—'}
          </p>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={runDiagnostic} disabled={diagLoading}
            style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', border:'none', borderRadius:10, padding:'10px 18px', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', opacity:diagLoading?0.7:1 }}>
            {diagLoading ? '⏳ Running...' : '🔄 Run Full Diagnostic'}
          </button>
          <button onClick={togglePush}
            style={{ background:pushOn?'rgba(34,197,94,0.15)':'rgba(255,255,255,0.06)', border:`1px solid ${pushOn?'#22c55e':'rgba(255,255,255,0.12)'}`, borderRadius:10, padding:'10px 16px', color:pushOn?'#22c55e':'#94a3b8', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            {pushOn ? '🔔 Push ON' : '🔕 Push OFF'}
          </button>
          <button onClick={toggleSound}
            style={{ background:soundOn?'rgba(234,179,8,0.15)':'rgba(255,255,255,0.06)', border:`1px solid ${soundOn?'#eab308':'rgba(255,255,255,0.12)'}`, borderRadius:10, padding:'10px 16px', color:soundOn?'#eab308':'#94a3b8', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            {soundOn ? '🔊 Sound ON' : '🔇 Sound OFF'}
          </button>
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:16, marginBottom:28 }}>
        <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:'20px 24px', display:'flex', flexDirection:'column', alignItems:'center' }}>
          <HealthGauge score={health?.overall ?? 0} />
          <div style={{ fontSize:12, color:'#64748b', marginTop:6 }}>Overall Health</div>
        </div>
        {[
          { label:'Total Services', value: Object.keys(services).length, icon:'⚙️', color:'#6366f1' },
          { label:'Healthy',  value: Object.values(services).filter((s:any)=>s.status==='HEALTHY').length,   icon:'🟢', color:'#22c55e' },
          { label:'Warnings', value: Object.values(services).filter((s:any)=>s.status==='WARNING'||s.status==='DEGRADED').length, icon:'🟡', color:'#eab308' },
          { label:'Critical', value: Object.values(services).filter((s:any)=>s.status==='CRITICAL').length,  icon:'🔴', color:'#ef4444' },
          { label:'Unread Alerts', value: unread, icon:'🔔', color:'#f97316' },
        ].map(s => (
          <div key={s.label} style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:'20px 24px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
            <div style={{ fontSize:28 }}>{s.icon}</div>
            <div style={{ fontSize:32, fontWeight:800, color:s.color, lineHeight:1.1 }}>{s.value}</div>
            <div style={{ fontSize:11, color:'#64748b', marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display:'flex', gap:4, marginBottom:20, background:'rgba(255,255,255,0.04)', borderRadius:12, padding:4, width:'fit-content' }}>
        {(['services','notifications','timeline','alerts'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ padding:'8px 18px', borderRadius:9, border:'none', fontSize:13, fontWeight:600, cursor:'pointer',
              background: activeTab===tab ? 'rgba(99,102,241,0.25)' : 'transparent',
              color: activeTab===tab ? '#818cf8' : '#64748b', transition:'all 0.2s' }}>
            {tab==='services'?'⚙️ Services':tab==='notifications'?`🔔 Alerts${unread?` (${unread})`:''}`:tab==='timeline'?'📅 Timeline':'🎯 Price Alerts'}
          </button>
        ))}
      </div>

      {/* ── Services Grid ── */}
      {activeTab === 'services' && (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:16, marginBottom:24 }}>
            {Object.entries(services).map(([name, svc]) => (
              <ServiceCard key={name} name={name} svc={svc as ServiceHealth}
                history={history[name] || []}
                onRestart={(action) => restartService(name, action)} />
            ))}
          </div>
          {diagText && (
            <div style={{ background:'rgba(0,0,0,0.3)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:12, padding:20, fontFamily:'monospace', fontSize:13, color:'#cbd5e1', whiteSpace:'pre-line', lineHeight:1.7 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12 }}>
                <span style={{ fontWeight:700, color:'#818cf8' }}>📋 Diagnostic Report</span>
                <button onClick={copyDiag} style={{ background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.4)', borderRadius:6, padding:'4px 12px', color:'#818cf8', fontSize:12, cursor:'pointer' }}>📋 Copy</button>
              </div>
              {diagText}
            </div>
          )}
        </>
      )}

      {/* ── Notifications ── */}
      {activeTab === 'notifications' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <span style={{ color:'#94a3b8', fontSize:13 }}>{notifs.length} notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.4)', borderRadius:8, padding:'6px 14px', color:'#818cf8', fontSize:12, cursor:'pointer' }}>
                ✅ Mark All Read
              </button>
            )}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {notifs.length === 0 && <div style={{ color:'#64748b', textAlign:'center', padding:40, fontSize:14 }}>No notifications yet. The system is running clean.</div>}
            {notifs.map(n => (
              <div key={n.id} style={{ background:n.read?'rgba(255,255,255,0.02)':SEVERITY_BG[n.severity]||'rgba(255,255,255,0.05)', border:`1px solid ${SEVERITY_COLOR[n.severity]||'#374151'}33`, borderRadius:10, padding:'14px 16px', opacity:n.read?0.7:1 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ background:`${SEVERITY_COLOR[n.severity]}22`, color:SEVERITY_COLOR[n.severity]||'#94a3b8', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20 }}>{n.severity}</span>
                    <span style={{ fontWeight:600, color:'#e2e8f0', fontSize:13 }}>{n.title}</span>
                  </div>
                  <span style={{ fontSize:11, color:'#64748b' }}>{new Date(n.timestamp).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})}</span>
                </div>
                <div style={{ fontSize:13, color:'#94a3b8' }}>{n.message}</div>
                {n.cause && <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>Cause: {n.cause}</div>}
                {n.suggested_fix && <div style={{ fontSize:12, color:'#6366f1', marginTop:4 }}>💡 {n.suggested_fix}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Timeline ── */}
      {activeTab === 'timeline' && (
        <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
          {timeline.length === 0 && <div style={{ color:'#64748b', textAlign:'center', padding:40, fontSize:14 }}>No events yet. Timeline builds as the system runs.</div>}
          {timeline.map((ev, i) => (
            <div key={ev.id} style={{ display:'flex', gap:16, paddingBottom:16 }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                <div style={{ width:12, height:12, borderRadius:'50%', background:STATUS_COLOR[ev.severity]||SEVERITY_COLOR[ev.severity]||'#6b7280', flexShrink:0, marginTop:3 }} />
                {i < timeline.length-1 && <div style={{ width:2, flex:1, background:'rgba(255,255,255,0.06)', marginTop:4 }} />}
              </div>
              <div style={{ flex:1, paddingBottom:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                  <span style={{ fontSize:11, color:'#64748b' }}>{new Date(ev.recorded_at).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})}</span>
                  <span style={{ fontSize:11, color:'#475569', background:'rgba(255,255,255,0.05)', padding:'1px 6px', borderRadius:4 }}>{ev.component}</span>
                </div>
                <div style={{ fontSize:13, color:'#cbd5e1' }}>{ev.event}</div>
                {ev.details && <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{ev.details}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Price Alerts ── */}
      {activeTab === 'alerts' && (
        <div>
          <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:20, marginBottom:20 }}>
            <h3 style={{ margin:'0 0 14px', fontSize:14, fontWeight:700, color:'#e2e8f0' }}>➕ Create Price Alert</h3>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
              <input value={newAlert.symbol} onChange={e => setNewAlert(a=>({...a,symbol:e.target.value.toUpperCase()}))}
                placeholder="Symbol (e.g. RELIANCE)" style={{ flex:1, minWidth:140, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, padding:'9px 14px', color:'#e2e8f0', fontSize:13 }} />
              <select value={newAlert.condition} onChange={e => setNewAlert(a=>({...a,condition:e.target.value as any}))}
                style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, padding:'9px 14px', color:'#e2e8f0', fontSize:13, cursor:'pointer' }}>
                <option value="ABOVE">Above ₹</option>
                <option value="BELOW">Below ₹</option>
              </select>
              <input value={newAlert.target_price} onChange={e => setNewAlert(a=>({...a,target_price:e.target.value}))}
                placeholder="Target price" type="number" style={{ flex:1, minWidth:120, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, padding:'9px 14px', color:'#e2e8f0', fontSize:13 }} />
              <button onClick={createAlert}
                style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', border:'none', borderRadius:8, padding:'9px 20px', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                Set Alert
              </button>
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {alerts.length === 0 && <div style={{ color:'#64748b', textAlign:'center', padding:40, fontSize:14 }}>No price alerts set. Create one above.</div>}
            {alerts.map(a => (
              <div key={a.id} style={{ background:a.triggered?'rgba(255,255,255,0.02)':'rgba(255,255,255,0.04)', border:`1px solid ${a.triggered?'rgba(255,255,255,0.06)':'rgba(99,102,241,0.3)'}`, borderRadius:10, padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', opacity:a.triggered?0.5:1 }}>
                <div>
                  <div style={{ fontWeight:700, color:'#e2e8f0', fontSize:14 }}>{a.symbol} <span style={{ color:'#818cf8' }}>{a.condition}</span> ₹{a.target_price}</div>
                  <div style={{ fontSize:11, color:'#64748b', marginTop:3 }}>
                    {a.triggered ? `✅ Triggered at ${(a as any).triggered_at ? new Date((a as any).triggered_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}) : '—'}` : '⏳ Watching...'}
                  </div>
                </div>
                <button onClick={() => deleteAlert(a.id)} style={{ background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:8, padding:'6px 12px', color:'#ef4444', fontSize:12, cursor:'pointer' }}>
                  🗑 Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
