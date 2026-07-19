/**
 * packages/phase10-copilot-intelligence/src/watchlist/WatchlistManager.ts
 * Artha AI — Phase 10 Watchlist Manager
 *
 * Lets the user tell the copilot which symbols to monitor closely.
 * Watchlisted symbols get a lower alert threshold (55% vs 65%).
 */

export interface WatchlistEntry {
  symbol:          string;
  added_at:        Date;
  min_confidence:  number;   // override threshold (default 0.55)
  note?:           string;   // e.g., "Expecting breakout"
}

export class WatchlistManager {
  private readonly watchlist = new Map<string, WatchlistEntry>();

  /** Add or update a symbol on the watchlist. */
  watch(symbol: string, note?: string, minConfidence = 0.55): WatchlistEntry {
    const entry: WatchlistEntry = {
      symbol: symbol.toUpperCase(),
      added_at: new Date(),
      min_confidence: minConfidence,
      note,
    };
    this.watchlist.set(symbol.toUpperCase(), entry);
    return entry;
  }

  /** Remove a symbol from the watchlist. */
  unwatch(symbol: string): boolean {
    return this.watchlist.delete(symbol.toUpperCase());
  }

  /** Returns the watchlist entry for a symbol, or null if not watching. */
  getEntry(symbol: string): WatchlistEntry | null {
    return this.watchlist.get(symbol.toUpperCase()) ?? null;
  }

  /** Returns all watchlisted symbols. */
  getAll(): WatchlistEntry[] {
    return Array.from(this.watchlist.values());
  }

  /** Returns true if symbol is being watched. */
  isWatched(symbol: string): boolean {
    return this.watchlist.has(symbol.toUpperCase());
  }

  /**
   * Returns the effective minimum confidence threshold for a symbol.
   * Watchlisted symbols get a lower threshold; others get the global default.
   */
  getThreshold(symbol: string, globalThreshold = 0.65): number {
    const entry = this.getEntry(symbol);
    return entry ? entry.min_confidence : globalThreshold;
  }

  /** Format the watchlist as a readable string for the copilot chat. */
  describe(): string {
    if (this.watchlist.size === 0) return 'Watchlist is empty. Say "watch SYMBOL" to add one.';
    const lines = this.getAll().map(e =>
      `  • ${e.symbol} (threshold: ${(e.min_confidence * 100).toFixed(0)}%)${e.note ? ` — ${e.note}` : ''}`
    );
    return `Watching ${this.watchlist.size} symbol(s):\n${lines.join('\n')}`;
  }
}
