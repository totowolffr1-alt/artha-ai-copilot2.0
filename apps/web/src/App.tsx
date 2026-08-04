import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
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

// Desktop sidebar nav
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

// Mobile bottom tab bar — 5 primary items
const MOBILE_TABS = [
  { to: '/',          icon: '📊', label: 'Home'      },
  { to: '/watchlist', icon: '📈', label: 'Watchlist' },
  { to: '/portfolio', icon: '💼', label: 'Portfolio' },
  { to: '/trade',     icon: '⚡',  label: 'Trade'     },
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
    <NavLink to="/system" style={{ textDecoration: 'none', position: 'relative', display: 'inline-block' }}>
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

export default function App() {
  return (
    <AuthGate>
      <BrowserRouter>
        <div className="app-shell">

          {/* ── Mobile top header (hidden on desktop via CSS) ── */}
          <header className="mobile-header">
            <span className="mobile-header-logo">⚡ Artha AI</span>
            <NotificationBell />
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

          {/* ── Mobile bottom tab bar (hidden on desktop via CSS) ── */}
          <nav className="mobile-bottom-nav">
            {MOBILE_TABS.map(tab => (
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
          </nav>

        </div>
      </BrowserRouter>
    </AuthGate>
  );
}
