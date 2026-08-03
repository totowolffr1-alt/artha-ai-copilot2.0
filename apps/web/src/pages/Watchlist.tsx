import { useState, useEffect, useRef, useCallback } from 'react';
import TradingChart from '../components/TradingChart';
import ConfidenceCard from '../components/ConfidenceCard';
import { watchlistStore, type Watchlist, type WatchlistStock } from '../services/watchlistStore';
import { getMarketSession } from '../services/marketSession';
import { subscribeTicks, type Tick } from '../services/api';

const BASE = '/api';

interface Quote {
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  change: number;
  changePct: number;
  volume: number;
}

// Realistic base prices for mock quotes
const BASE_PRICES: Record<string, number> = {
  RELIANCE: 2880, TCS: 3600, INFY: 1590, HDFCBANK: 1330, ICICIBANK: 1240,
  WIPRO: 540, TATAMOTORS: 960, SBIN: 820, BAJFINANCE: 7200, ZOMATO: 265,
  PAYTM: 880, CUPID: 215, KPITTECH: 1680, BANDHANBNK: 210, IRCTC: 880,
  ADANIPORTS: 1340, SUNPHARMA: 1720, ASIANPAINT: 2450, TITAN: 3300,
  LTIM: 5200, HCLTECH: 1750, ONGC: 285, NTPC: 365, HAL: 4100,
};

function getMockQuote(symbol: string): Quote {
  const base = BASE_PRICES[symbol] || 500;
  const session = getMarketSession();
  // Freeze prices if market is closed — no random movement
  const seed = session.isOpen ? (Date.now() / 5000) : 0;
  const rng = Math.sin(seed + symbol.charCodeAt(0) * 9.1) * 0.5 + 0.5;
  const changePct = session.isOpen ? (rng - 0.5) * 4 : 0;
  const change = (base * changePct) / 100;
  const ltp = base + change;
  return {
    symbol,
    ltp: parseFloat(ltp.toFixed(2)),
    open: parseFloat((base * (1 + (rng * 0.01 - 0.005))).toFixed(2)),
    high: parseFloat((ltp * 1.015).toFixed(2)),
    low: parseFloat((ltp * 0.985).toFixed(2)),
    prevClose: base,
    change: parseFloat(change.toFixed(2)),
    changePct: parseFloat(changePct.toFixed(2)),
    volume: Math.floor((rng * 800000) + 100000),
  };
}

// ── Search ────────────────────────────────────────────────────────────────────
async function searchStocks(q: string): Promise<Array<{ symbol: string; name: string; exchange: string }>> {
  if (q.length < 1) return [];
  try {
    const res = await fetch(`${BASE}/market/search?q=${encodeURIComponent(q)}`);
    const json = await res.json();
    return json.results || [];
  } catch {
    // Fallback local search
    const LOCAL = [
      { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE' },
      { symbol: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE' },
      { symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE' },
      { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', exchange: 'NSE' },
      { symbol: 'CUPID', name: 'Cupid Ltd', exchange: 'NSE' },
      { symbol: 'ZOMATO', name: 'Zomato Ltd', exchange: 'NSE' },
      { symbol: 'TATAMOTORS', name: 'Tata Motors Ltd', exchange: 'NSE' },
      { symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE' },
      { symbol: 'IRCTC', name: 'Indian Railway Catering & Tourism', exchange: 'NSE' },
      { symbol: 'KPITTECH', name: 'KPIT Technologies Ltd', exchange: 'NSE' },
      { symbol: 'HAL', name: 'Hindustan Aeronautics Ltd', exchange: 'NSE' },
      { symbol: 'NTPC', name: 'NTPC Ltd', exchange: 'NSE' },
    ];
    return LOCAL.filter(s =>
      s.symbol.toLowerCase().includes(q.toLowerCase()) ||
      s.name.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 8);
  }
}

// ── Stock Row ─────────────────────────────────────────────────────────────────
function StockRow({ stock, quote, isSelected, isMobile, onSelect, onRemove, onPin }: {
  stock: WatchlistStock;
  quote: Quote;
  isSelected: boolean;
  isMobile: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onPin: () => void;
}) {
  const isUp = quote.changePct >= 0;
  const color = isUp ? '#10b981' : '#ef4444';

  return (
    <div onClick={onSelect} style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '24px 1fr 75px 70px 30px' : '28px 1fr 90px 80px 70px 80px 80px 50px',
      alignItems: 'center', gap: 8,
      padding: '10px 14px',
      borderRadius: 8,
      cursor: 'pointer',
      background: isSelected ? 'rgba(99,102,241,0.12)' : 'transparent',
      border: isSelected ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
      transition: 'all 0.15s ease',
    }}
      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {/* Pin */}
      <button onClick={e => { e.stopPropagation(); onPin(); }} className="secondary" style={{
        padding: 0, width: 24, height: 24, fontSize: 14, background: 'transparent', border: 'none', boxShadow: 'none',
        color: stock.pinned ? '#fbbf24' : 'rgba(255,255,255,0.2)',
      }}>
        {stock.pinned ? '★' : '☆'}
      </button>

      {/* Symbol + Exchange */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>{stock.symbol}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{stock.exchange}</div>
      </div>

      {/* LTP */}
      <div style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#fff', fontSize: 13 }}>
        ₹{quote.ltp.toFixed(2)}
      </div>

      {/* Change % */}
      <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color, fontWeight: 600 }}>
        {isUp ? '+' : ''}{quote.changePct.toFixed(2)}%
      </div>

      {/* Change ₹ */}
      {!isMobile && (
        <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color }}>
          {isUp ? '+' : ''}₹{quote.change.toFixed(2)}
        </div>
      )}

      {/* Volume */}
      {!isMobile && (
        <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
          {quote.volume > 1e6 ? `${(quote.volume / 1e6).toFixed(1)}M` : `${(quote.volume / 1e3).toFixed(0)}K`}
        </div>
      )}

      {/* High / Low */}
      {!isMobile && (
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', lineHeight: 1.4 }}>
          <div style={{ color: '#10b981' }}>H {quote.high.toFixed(0)}</div>
          <div style={{ color: '#ef4444' }}>L {quote.low.toFixed(0)}</div>
        </div>
      )}

      {/* Remove */}
      <button onClick={e => { e.stopPropagation(); onRemove(); }} className="secondary" style={{
        padding: 0, width: 24, height: 24, fontSize: 14, background: 'transparent', border: 'none', boxShadow: 'none',
        color: 'rgba(239,68,68,0.4)',
      }}
        onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(239,68,68,0.4)')}
      >✕</button>
    </div>
  );
}

// ── Main Watchlist Page ───────────────────────────────────────────────────────
export default function Watchlist() {
  const [lists, setLists] = useState<Watchlist[]>(watchlistStore.getAll());
  const [activeListId, setActiveListId] = useState(watchlistStore.getActive());
  const [selectedSymbol, setSelectedSymbol] = useState('RELIANCE');
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ symbol: string; name: string; exchange: string }>>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [session] = useState(getMarketSession());
  const searchRef = useRef<HTMLDivElement>(null);

  // Mobile layout state
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [mobileView, setMobileView] = useState<'list' | 'chart'>('list');
  const searchRefMobile = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      const mob = window.innerWidth <= 768;
      setIsMobile(mob);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeList = lists.find(l => l.id === activeListId) || lists[0];

  const refresh = () => {
    setLists([...watchlistStore.getAll()]);
  };

  // Load real quotes from backend & update via live ticks stream
  useEffect(() => {
    const fetchRealQuotes = async () => {
      const allSymbols = watchlistStore.getAllSymbols();
      if (allSymbols.length === 0) return;
      try {
        const res = await fetch(`${BASE}/market/quotes?symbols=${allSymbols.join(',')}`);
        const data = await res.json();
        if (data.quotes) {
          const newQuotes: Record<string, Quote> = {};
          data.quotes.forEach((q: Quote) => {
            newQuotes[q.symbol] = q;
          });
          setQuotes(prev => ({ ...prev, ...newQuotes }));
        }
      } catch (err) {
        console.error('Failed to fetch real quotes:', err);
      }
    };

    fetchRealQuotes();

    let intervalId: NodeJS.Timeout | undefined;
    if (session.isOpen) {
      intervalId = setInterval(fetchRealQuotes, 10000);
    }

    const unsubscribeTicks = subscribeTicks((tick: Tick) => {
      setQuotes(prev => {
        const existing = prev[tick.symbol];
        if (!existing) return prev;

        const updatedLtp = tick.price;
        const diff = updatedLtp - existing.prevClose;
        const changePct = existing.prevClose > 0 ? (diff / existing.prevClose) * 100 : 0;

        return {
          ...prev,
          [tick.symbol]: {
            ...existing,
            ltp: updatedLtp,
            high: Math.max(existing.high, updatedLtp),
            low: Math.min(existing.low, updatedLtp),
            change: diff,
            changePct: changePct,
          }
        };
      });
    });

    return () => {
      if (intervalId) clearInterval(intervalId);
      unsubscribeTicks();
    };
  }, [lists, session.isOpen]);

  // Search
  useEffect(() => {
    const t = setTimeout(async () => {
      if (searchQ.length > 0) {
        const results = await searchStocks(searchQ);
        setSearchResults(results);
      } else {
        setSearchResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [searchQ]);

  // Close search on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const clickInSearch = searchRef.current?.contains(e.target as Node);
      const clickInMobileSearch = searchRefMobile.current?.contains(e.target as Node);
      if (!clickInSearch && !clickInMobileSearch) {
        setShowSearch(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleAddStock = (symbol: string, exchange: string) => {
    watchlistStore.addStock(activeListId, symbol, exchange);
    refresh();
    setSearchQ('');
    setShowSearch(false);
    setSelectedSymbol(symbol);
  };

  const handleRemove = (symbol: string) => {
    watchlistStore.removeStock(activeListId, symbol);
    refresh();
  };

  const handlePin = (symbol: string) => {
    watchlistStore.pinStock(activeListId, symbol);
    refresh();
  };

  const handleCreateList = () => {
    const name = prompt('New watchlist name:');
    if (name) {
      const wl = watchlistStore.createList(name);
      setActiveListId(wl.id);
      watchlistStore.setActive(wl.id);
      refresh();
    }
  };

  const handleDeleteList = (id: string) => {
    if (!confirm('Delete this watchlist?')) return;
    watchlistStore.deleteList(id);
    const remaining = watchlistStore.getAll();
    setActiveListId(remaining[0]?.id || 'default');
    refresh();
  };

  const handleExport = () => {
    const json = watchlistStore.exportJSON(activeListId);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `${activeList?.name || 'watchlist'}.json`;
    a.click();
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const ok = watchlistStore.importJSON(ev.target?.result as string);
        if (ok) { refresh(); alert('Watchlist imported!'); }
        else alert('Invalid watchlist file.');
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Sorted stocks: pinned first
  const stocks = [...(activeList?.stocks || [])].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  return (
    <div>
      <h2>📈 Watchlist <span className="badge">LIVE</span></h2>

      {/* Session Banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
        background: session.isOpen ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
        border: `1px solid ${session.isOpen ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
        borderRadius: 10, marginBottom: 16, fontSize: 13,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
          background: session.isOpen ? '#10b981' : '#ef4444',
          boxShadow: session.isOpen ? '0 0 6px #10b981' : 'none',
          animation: session.isOpen ? 'pulse 1.5s infinite' : 'none',
        }} />
        <strong style={{ color: session.isOpen ? '#34d399' : '#f87171' }}>{session.status}</strong>
        <span style={{ color: 'var(--muted)' }}>{session.message}</span>
        {!session.isOpen && !isMobile && <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontFamily: 'monospace', fontSize: 12 }}>
          Prices frozen at close · Next open {new Date(session.nextOpen).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST
        </span>}
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>

      {/* Global Mobile Search Bar (Only visible on mobile, always active) */}
      {isMobile && (
        <div ref={searchRefMobile} style={{ position: 'relative', marginBottom: 12 }}>
          <input
            value={searchQ}
            onChange={e => { setSearchQ(e.target.value); setShowSearch(true); }}
            onFocus={() => setShowSearch(true)}
            placeholder="🔍  Search & open chart..."
            style={{ width: '100%', padding: '12px 16px', fontSize: 14, borderRadius: 10 }}
          />
          {showSearch && searchResults.length > 0 && (
            <div style={{
              position: 'absolute', top: '110%', left: 0, right: 0,
              background: '#111827', border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 10, zIndex: 100, overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}>
              {searchResults.map(r => (
                <div
                  key={r.symbol}
                  onClick={() => {
                    handleAddStock(r.symbol, r.exchange);
                    setMobileView('chart'); // Auto open chart on search select
                  }}
                  style={{
                    padding: '10px 14px', cursor: 'pointer', display: 'flex',
                    justifyContent: 'space-between', alignItems: 'center',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>{r.symbol}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.name}</div>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4 }}>
                    {r.exchange} +
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mobile Segmented View Switcher (Only visible on mobile) */}
      {isMobile && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button 
            onClick={() => setMobileView('list')} 
            className={mobileView === 'list' ? '' : 'secondary'} 
            style={{ flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 8, height: 40 }}
          >
            📋 Watchlist Stock List
          </button>
          <button 
            onClick={() => setMobileView('chart')} 
            className={mobileView === 'chart' ? '' : 'secondary'} 
            style={{ flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 8, height: 40 }}
          >
            📈 Chart: {selectedSymbol}
          </button>
        </div>
      )}

      {/* Main Layout Grid */}
      <div className="watchlist-layout">
        {/* Watchlist Panel (Left on Desktop, conditional on Mobile) */}
        {(!isMobile || mobileView === 'list') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Watchlist Tabs */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {lists.map(l => (
                <div key={l.id} style={{ position: 'relative' }}>
                  {renamingId === l.id ? (
                    <input
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onBlur={() => {
                        if (renameVal) watchlistStore.renameList(l.id, renameVal);
                        setRenamingId(null);
                        refresh();
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          if (renameVal) watchlistStore.renameList(l.id, renameVal);
                          setRenamingId(null);
                          refresh();
                        }
                      }}
                      autoFocus
                      style={{ width: 100, padding: '4px 8px', fontSize: 12, borderRadius: 6 }}
                    />
                  ) : (
                    <button
                      onClick={() => { setActiveListId(l.id); watchlistStore.setActive(l.id); }}
                      onDoubleClick={() => { setRenamingId(l.id); setRenameVal(l.name); }}
                      className={activeListId === l.id ? '' : 'secondary'}
                      style={{ padding: '5px 12px', fontSize: 12, borderRadius: 8 }}
                    >
                      {l.name}
                    </button>
                  )}
                </div>
              ))}
              <button onClick={handleCreateList} className="secondary" style={{ padding: '5px 10px', fontSize: 18, lineHeight: 1, borderRadius: 8 }}>+</button>
            </div>

            {/* Action Bar */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleExport} className="secondary" style={{ fontSize: 11, padding: '5px 10px', flex: 1 }}>⬇ Export</button>
              <button onClick={handleImport} className="secondary" style={{ fontSize: 11, padding: '5px 10px', flex: 1 }}>⬆ Import</button>
              {lists.length > 1 && <button onClick={() => handleDeleteList(activeListId)} className="secondary" style={{ fontSize: 11, padding: '5px 10px', color: '#f87171' }}>🗑</button>}
            </div>

            {/* Search Bar (Only desktop) */}
            {!isMobile && (
              <div ref={searchRef} style={{ position: 'relative' }}>
                <input
                  value={searchQ}
                  onChange={e => { setSearchQ(e.target.value); setShowSearch(true); }}
                  onFocus={() => setShowSearch(true)}
                  placeholder="🔍  Search by name or symbol..."
                  style={{ width: '100%', padding: '10px 14px', fontSize: 13 }}
                />
                {showSearch && searchResults.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '110%', left: 0, right: 0,
                    background: '#111827', border: '1px solid rgba(99,102,241,0.3)',
                    borderRadius: 10, zIndex: 100, overflow: 'hidden',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  }}>
                    {searchResults.map(r => (
                      <div
                        key={r.symbol}
                        onClick={() => handleAddStock(r.symbol, r.exchange)}
                        style={{
                          padding: '10px 14px', cursor: 'pointer', display: 'flex',
                          justifyContent: 'space-between', alignItems: 'center',
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>{r.symbol}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.name}</div>
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4 }}>
                          {r.exchange} +
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Column Headers */}
            <div style={{
              display: 'grid', 
              gridTemplateColumns: isMobile ? '24px 1fr 75px 70px 30px' : '28px 1fr 90px 80px 70px 80px 80px 50px',
              gap: 8, padding: '4px 14px', fontSize: 10, color: 'var(--muted)', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              <span />
              <span>Symbol</span>
              <span style={{ textAlign: 'right' }}>LTP</span>
              <span style={{ textAlign: 'right' }}>Chg%</span>
              {!isMobile && <span style={{ textAlign: 'right' }}>Chg₹</span>}
              {!isMobile && <span style={{ textAlign: 'right' }}>Volume</span>}
              {!isMobile && <span>H/L</span>}
              <span />
            </div>

            {/* Stock Rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', maxHeight: isMobile ? '60vh' : '65vh' }}>
              {stocks.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30, fontSize: 13 }}>
                  Search and add stocks to your watchlist
                </div>
              ) : stocks.map(stock => (
                <StockRow
                  key={stock.symbol}
                  stock={stock}
                  quote={quotes[stock.symbol] || getMockQuote(stock.symbol)}
                  isSelected={selectedSymbol === stock.symbol}
                  isMobile={isMobile}
                  onSelect={() => {
                    setSelectedSymbol(stock.symbol);
                    if (isMobile) {
                      setMobileView('chart');
                    }
                  }}
                  onRemove={() => handleRemove(stock.symbol)}
                  onPin={() => handlePin(stock.symbol)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Chart Panel (Right on Desktop, conditional on Mobile) */}
        {(!isMobile || mobileView === 'chart') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
            <TradingChart symbol={selectedSymbol} />
            <ConfidenceCard symbol={selectedSymbol} />
          </div>
        )}
      </div>
    </div>
  );
}
