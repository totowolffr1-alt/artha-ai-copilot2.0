/**
 * packages/phase10-copilot-intelligence/src/universe/SmallCapUniverseLoader.ts
 * Artha AI — Small-Cap Universe Loader
 *
 * Loads NSE Smallcap 100 / 250 constituents from the database.
 * Tags each symbol with its index tier, circuit category, and liquidity metrics.
 * Used by Phase 6 (risk profile), Phase 9 (circuit guard), Phase 10 (scoring).
 */

export type SmallCapIndex    = 'SMALLCAP_100' | 'SMALLCAP_250' | 'MIDCAP_100' | 'LARGECAP';
export type CircuitCategory  = 'CAT_A' | 'CAT_B' | 'CAT_T' | 'CAT_Z';

export interface UniverseEntry {
  symbol:           string;
  company_name:     string;
  sector:           string;
  index_name:       SmallCapIndex;
  circuit_category: CircuitCategory;
  avg_daily_volume: number;    // shares/day
  market_cap_cr:    number;    // crores
}

/** Circuit limit percentages per category */
export const CIRCUIT_LIMIT_PCT: Record<CircuitCategory, number> = {
  CAT_A: 20,
  CAT_B: 10,
  CAT_T: 5,
  CAT_Z: 5,
};

/** Risk ATR multiplier overrides for small caps (vs large-cap defaults) */
export const SMALLCAP_ATR_MULTIPLIERS: Record<SmallCapIndex, { bull: number; neutral: number; volatile: number }> = {
  SMALLCAP_100: { bull: 2.8, neutral: 1.8, volatile: 3.5 },
  SMALLCAP_250: { bull: 3.2, neutral: 2.0, volatile: 4.0 },
  MIDCAP_100:   { bull: 2.5, neutral: 1.6, volatile: 3.2 },
  LARGECAP:     { bull: 2.2, neutral: 1.3, volatile: 2.8 }, // original Phase 7 defaults
};

/** Min avg daily volume for a trade to be considered liquid enough */
export const MIN_LIQUID_VOLUME: Record<SmallCapIndex, number> = {
  SMALLCAP_100: 50_000,    // 50k shares/day
  SMALLCAP_250: 25_000,    // 25k shares/day (thinner)
  MIDCAP_100:   200_000,
  LARGECAP:     1_000_000,
};

export class SmallCapUniverseLoader {
  /** In-memory cache: symbol → UniverseEntry */
  private cache = new Map<string, UniverseEntry>();
  private loadedAt: Date | null = null;

  constructor(
    /** Injectable DB query function — returns rows from smallcap_universe */
    private readonly queryDb: () => Promise<UniverseEntry[]>,
    /** Cache TTL in ms. Default: 24 hours (universe updated monthly) */
    private readonly cacheTtlMs: number = 24 * 60 * 60 * 1000
  ) {}

  /** Load universe from DB into cache (or refresh if stale). */
  async load(): Promise<void> {
    if (this.loadedAt && Date.now() - this.loadedAt.getTime() < this.cacheTtlMs) {
      return; // Cache still fresh
    }

    const rows = await this.queryDb();
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.symbol.toUpperCase(), row);
    }
    this.loadedAt = new Date();
    console.log(`[SmallCapUniverseLoader] Loaded ${this.cache.size} symbols into universe cache.`);
  }

  /** Returns the universe entry for a symbol, or null if not in universe. */
  getEntry(symbol: string): UniverseEntry | null {
    return this.cache.get(symbol.toUpperCase()) ?? null;
  }

  /** Returns true if the symbol is in the small-cap universe. */
  isSmallCap(symbol: string): boolean {
    const entry = this.getEntry(symbol);
    return entry !== null && (entry.index_name === 'SMALLCAP_100' || entry.index_name === 'SMALLCAP_250');
  }

  /** Returns the circuit limit % for a symbol. Defaults to 20% if unknown. */
  getCircuitLimitPct(symbol: string): number {
    const entry = this.getEntry(symbol);
    if (!entry) return 20;
    return CIRCUIT_LIMIT_PCT[entry.circuit_category];
  }

  /** Returns the ATR multipliers to use for a symbol based on its index tier. */
  getAtrMultipliers(symbol: string): { bull: number; neutral: number; volatile: number } {
    const entry = this.getEntry(symbol);
    const tier = entry?.index_name ?? 'LARGECAP';
    return SMALLCAP_ATR_MULTIPLIERS[tier];
  }

  /**
   * Returns true if a symbol has sufficient average daily volume to trade.
   * Prevents entering thinly traded stocks where our order would move the price.
   */
  isLiquidEnough(symbol: string, qty: number): boolean {
    const entry = this.getEntry(symbol);
    if (!entry) return true; // Unknown symbol — assume liquid (large-cap)
    const minVol = MIN_LIQUID_VOLUME[entry.index_name];
    // Order should be < 1% of avg daily volume to avoid market impact
    return qty <= entry.avg_daily_volume * 0.01 &&
           entry.avg_daily_volume >= minVol;
  }

  /** Get all symbols in a specific index. */
  getByIndex(index: SmallCapIndex): UniverseEntry[] {
    return Array.from(this.cache.values()).filter(e => e.index_name === index);
  }

  /** Total symbols loaded. */
  get size(): number {
    return this.cache.size;
  }
}
