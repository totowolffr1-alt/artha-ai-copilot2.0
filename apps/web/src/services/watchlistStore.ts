/**
 * watchlistStore.ts
 * localStorage-backed multi-watchlist manager with API sync.
 * Primary source of truth is localStorage — instant reads even when offline.
 */

export interface WatchlistStock {
  symbol: string;
  exchange: string;
  pinned: boolean;
  addedAt: string;
}

export interface Watchlist {
  id: string;
  name: string;
  stocks: WatchlistStock[];
  createdAt: string;
}

const STORAGE_KEY = 'artha_watchlists_v1';
const ACTIVE_KEY = 'artha_active_watchlist_v1';

function load(): Watchlist[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [
    {
      id: 'default',
      name: 'My Watchlist',
      createdAt: new Date().toISOString(),
      stocks: [
        { symbol: 'RELIANCE', exchange: 'NSE', pinned: false, addedAt: new Date().toISOString() },
        { symbol: 'TCS', exchange: 'NSE', pinned: false, addedAt: new Date().toISOString() },
        { symbol: 'INFY', exchange: 'NSE', pinned: false, addedAt: new Date().toISOString() },
        { symbol: 'CUPID', exchange: 'NSE', pinned: true, addedAt: new Date().toISOString() },
        { symbol: 'ZOMATO', exchange: 'NSE', pinned: false, addedAt: new Date().toISOString() },
        { symbol: 'HDFCBANK', exchange: 'NSE', pinned: false, addedAt: new Date().toISOString() },
      ],
    },
  ];
}

function save(lists: Watchlist[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
}

class WatchlistStore {
  private lists: Watchlist[] = load();

  getAll(): Watchlist[] { return this.lists; }

  getActive(): string {
    return localStorage.getItem(ACTIVE_KEY) || this.lists[0]?.id || 'default';
  }

  setActive(id: string) {
    localStorage.setItem(ACTIVE_KEY, id);
  }

  getList(id: string): Watchlist | undefined {
    return this.lists.find(l => l.id === id);
  }

  createList(name: string): Watchlist {
    const wl: Watchlist = { id: Date.now().toString(), name, stocks: [], createdAt: new Date().toISOString() };
    this.lists.push(wl);
    save(this.lists);
    return wl;
  }

  renameList(id: string, name: string) {
    const wl = this.lists.find(l => l.id === id);
    if (wl) { wl.name = name; save(this.lists); }
  }

  deleteList(id: string) {
    if (this.lists.length <= 1) return; // keep at least one
    this.lists = this.lists.filter(l => l.id !== id);
    save(this.lists);
  }

  addStock(listId: string, symbol: string, exchange = 'NSE'): boolean {
    const wl = this.lists.find(l => l.id === listId);
    if (!wl) return false;
    if (wl.stocks.find(s => s.symbol === symbol)) return false;
    wl.stocks.push({ symbol, exchange, pinned: false, addedAt: new Date().toISOString() });
    save(this.lists);
    return true;
  }

  removeStock(listId: string, symbol: string) {
    const wl = this.lists.find(l => l.id === listId);
    if (!wl) return;
    wl.stocks = wl.stocks.filter(s => s.symbol !== symbol);
    save(this.lists);
  }

  pinStock(listId: string, symbol: string) {
    const wl = this.lists.find(l => l.id === listId);
    const stock = wl?.stocks.find(s => s.symbol === symbol);
    if (stock) { stock.pinned = !stock.pinned; save(this.lists); }
  }

  hasStock(symbol: string): boolean {
    return this.lists.some(l => l.stocks.some(s => s.symbol === symbol));
  }

  getAllSymbols(): string[] {
    const set = new Set<string>();
    this.lists.forEach(l => l.stocks.forEach(s => set.add(s.symbol)));
    return Array.from(set);
  }

  exportJSON(listId: string): string {
    const wl = this.lists.find(l => l.id === listId);
    return JSON.stringify(wl, null, 2);
  }

  importJSON(json: string): boolean {
    try {
      const wl = JSON.parse(json) as Watchlist;
      if (!wl.name || !Array.isArray(wl.stocks)) return false;
      wl.id = Date.now().toString();
      wl.createdAt = new Date().toISOString();
      this.lists.push(wl);
      save(this.lists);
      return true;
    } catch { return false; }
  }
}

export const watchlistStore = new WatchlistStore();
