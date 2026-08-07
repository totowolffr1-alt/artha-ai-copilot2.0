import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import AIChat from './pages/AIChat';
import Portfolio from './pages/Portfolio';
import Watchlist from './pages/Watchlist';
import Backtesting from './pages/Backtesting';
import NewsIntelligence from './pages/NewsIntelligence';
import SystemHealth from './pages/SystemHealth';
import ManualTrade from './pages/ManualTrade';
import SandboxPage from './pages/Sandbox';
import BrokerSettings from './pages/BrokerSettings';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './components/AuthGate';

// All 10 navigation pages
const NAV = [
  { to: '/',            label: '📊 Dashboard' },
  { to: '/watchlist',   label: '📈 Watchlist' },
  { to: '/portfolio',   label: '💼 Portfolio' },
  { to: '/trade',       label: '⚡ Trade' },
  { to: '/ai-chat',     label: '🤖 AI Copilot' },
  { to: '/backtesting', label: '🧪 Backtesting' },
  { to: '/news',        label: '📰 News Intel' },
  { to: '/system',      label: '⚙️ System Health' },
  { to: '/sandbox',     label: '🧪 Dual Sandbox' },
  { to: '/broker',      label: '🔌 Broker Settings' },
];

// Mobile bottom tab bar — 4 primary items + More drawer
const PRIMARY_MOBILE_TABS = [
  { to: '/',          icon: '📊', label: 'Home'      },
  { to: '/watchlist', icon: '📈', label: 'Watchlist' },
  { to: '/portfolio', icon: '💼', label: 'Portfolio' },
  { to: '/ai-chat',   icon: '🤖', label: 'AI'        },
];

function wrap(element: React.ReactElement) {
  return <ErrorBoundary>{element}</ErrorBoundary>;
}

/** Notification bell — used in both header variants */
function NotificationBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/api/system/notifications?limit=1');
        const d = await r.json();
        setUnread(d.unread ?? 0);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <NavLink to="/system" style={{ textDecoration: 'none', position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span style={{ fontSize: 20, cursor: 'pointer' }}>🔔</span>
      {unread > 0 && (
        <span style={{
          position: 'absolute', top: -4, right: -6,
          background: '#ef4444', color: '#fff',
          borderRadius: '50%', fontSize: 10, fontWeight: 700,
          minWidth: 18, height: 18, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          padding: '0 3px', lineHeight: 1,
        }}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </NavLink>
  );
}

/** Mobile More Drawer for accessing all 10 pages on mobile */
function MobileDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const location = useLocation();

  useEffect(() => {
    onClose();
  }, [location.pathname]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2000,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111827',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          padding: '20px 20px 30px',
          borderTop: '1px solid rgba(99,102,241,0.3)',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.8)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>⚡ All Navigation Pages</span>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none',
              color: '#fff',
              borderRadius: '50%',
              width: 32,
              height: 32,
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                padding: '12px 14px',
                borderRadius: 10,
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 600,
                background: isActive ? 'linear-gradient(135deg, #6366f1 0%, #a78bfa 100%)' : 'rgba(255,255,255,0.04)',
                color: isActive ? '#fff' : 'var(--muted)',
                border: '1px solid rgba(255,255,255,0.06)',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <AuthGate>
      <BrowserRouter>
        <div className="app-shell">

          {/* ── Mobile top header ── */}
          <header className="mobile-header">
            <span className="mobile-header-logo">⚡ Artha AI</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <NotificationBell />
              <button
                onClick={() => setDrawerOpen(true)}
                style={{
                  background: 'rgba(99,102,241,0.15)',
                  border: '1px solid rgba(99,102,241,0.3)',
                  color: '#a78bfa',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>☰</span>
                <span>Menu</span>
              </button>
            </div>
          </header>

          {/* ── Desktop / tablet sidebar ── */}
          <aside className="sidebar">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', marginBottom: 4 }}>
              <h1 style={{ margin: 0 }}>Artha AI</h1>
              <NotificationBell />
            </div>
            <nav>
              {NAV.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </aside>

          {/* ── Main content area ── */}
          <main className="main">
            <Routes>
              <Route path="/"            element={wrap(<Dashboard />)} />
              <Route path="/watchlist"   element={wrap(<Watchlist />)} />
              <Route path="/portfolio"   element={wrap(<Portfolio />)} />
              <Route path="/trade"       element={wrap(<ManualTrade />)} />
              <Route path="/ai-chat"     element={wrap(<AIChat />)} />
              <Route path="/backtesting" element={wrap(<Backtesting />)} />
              <Route path="/news"        element={wrap(<NewsIntelligence />)} />
              <Route path="/system"      element={wrap(<SystemHealth />)} />
              <Route path="/sandbox"     element={wrap(<SandboxPage />)} />
              <Route path="/broker"      element={wrap(<BrokerSettings />)} />
            </Routes>
          </main>

          {/* ── Mobile bottom tab bar ── */}
          <nav className="mobile-bottom-nav">
            {PRIMARY_MOBILE_TABS.map(tab => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === '/'}
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                <span className="tab-icon">{tab.icon}</span>
                <span>{tab.label}</span>
              </NavLink>
            ))}
            <button
              onClick={() => setDrawerOpen(true)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                background: 'none',
                border: 'none',
                color: '#6b7280',
                fontSize: 10,
                fontWeight: 500,
                padding: '8px 0',
                cursor: 'pointer',
              }}
            >
              <span className="tab-icon">☰</span>
              <span>More</span>
            </button>
          </nav>

          {/* ── Mobile More Navigation Drawer ── */}
          <MobileDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />

        </div>
      </BrowserRouter>
    </AuthGate>
  );
}
