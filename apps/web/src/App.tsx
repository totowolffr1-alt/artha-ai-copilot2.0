import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import AIChat from './pages/AIChat';
import Portfolio from './pages/Portfolio';
import Watchlist from './pages/Watchlist';
import Backtesting from './pages/Backtesting';
import NewsIntelligence from './pages/NewsIntelligence';
import { ErrorBoundary } from './components/ErrorBoundary';

const NAV = [
  { to: '/', label: '📊 Dashboard' },
  { to: '/watchlist', label: '📈 Watchlist' },
  { to: '/portfolio', label: '💼 Portfolio' },
  { to: '/ai-chat', label: '🤖 AI Copilot' },
  { to: '/backtesting', label: '🧪 Backtesting' },
  { to: '/news', label: '📰 News Intel' },
];

function wrap(element: React.ReactElement) {
  return <ErrorBoundary>{element}</ErrorBoundary>;
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <aside className="sidebar">
          <h1>Artha AI</h1>
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
        <main className="main">
          <Routes>
            <Route path="/"           element={wrap(<Dashboard />)} />
            <Route path="/watchlist"  element={wrap(<Watchlist />)} />
            <Route path="/portfolio"  element={wrap(<Portfolio />)} />
            <Route path="/ai-chat"    element={wrap(<AIChat />)} />
            <Route path="/backtesting" element={wrap(<Backtesting />)} />
            <Route path="/news"       element={wrap(<NewsIntelligence />)} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

