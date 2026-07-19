/**
 * packages/phase6-tradingview/src/portfolio/correlation/CorrelationMatrix.ts
 * Artha AI — Phase 6 Risk Engine — Stage 1
 *
 * Pre-computed Pearson correlation matrix for portfolio symbols.
 * Hydrated from Phase 3 DB at startup (or EOD job) — zero hot-path I/O.
 *
 * Used by PortfolioHeatCalculator to estimate inter-position correlation.
 */

export class CorrelationMatrix {
  /** symbol_id → symbol_id → correlation ∈ [-1, 1] */
  private readonly matrix: Map<string, Map<string, number>> = new Map();

  /**
   * Hydrate from an array of precomputed pairwise correlations.
   */
  hydrate(entries: Array<{ a: string; b: string; correlation: number }>): void {
    for (const { a, b, correlation } of entries) {
      if (!this.matrix.has(a)) this.matrix.set(a, new Map());
      if (!this.matrix.has(b)) this.matrix.set(b, new Map());
      this.matrix.get(a)!.set(b, correlation);
      this.matrix.get(b)!.set(a, correlation);
    }
  }

  /**
   * Returns correlation between two symbols.
   * Defaults to a conservative estimate (0.40) if unknown.
   */
  get(symbol_a: string, symbol_b: string, defaultCorr = 0.40): number {
    if (symbol_a === symbol_b) return 1.0;
    return this.matrix.get(symbol_a)?.get(symbol_b) ?? defaultCorr;
  }

  /**
   * Average pairwise correlation of a set of symbols.
   */
  averageCorrelation(symbols: string[]): number {
    if (symbols.length <= 1) return 0;

    let sum = 0;
    let count = 0;

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        sum += this.get(symbols[i], symbols[j]);
        count++;
      }
    }

    return count > 0 ? sum / count : 0;
  }

  has(symbol_a: string, symbol_b: string): boolean {
    return this.matrix.get(symbol_a)?.has(symbol_b) ?? false;
  }
}
