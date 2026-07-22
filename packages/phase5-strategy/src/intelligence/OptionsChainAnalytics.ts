/**
 * OptionsChainAnalytics.ts — Phase 20 Options PCR & IV Intelligence
 * ─────────────────────────────────────────────────────────────────────────────
 * Analyzes Nifty / BankNifty options chain metrics (PCR, IV Rank, Max Pain)
 * to infer institutional positioning and gate spot trading signals.
 *
 * QUANT RATIONALE:
 * Option market makers and institutional writers control key market levels.
 *  - PCR > 1.2 indicates heavy put writing (institutions creating a floor).
 *  - PCR < 0.7 indicates heavy call writing (institutions building a ceiling).
 *  - High IV Rank (> 70) favors mean reversion; Low IV Rank (< 30) favors breakouts.
 */

export interface OptionStrike {
  strikePrice: number;
  callOI: number;
  callIV: number;
  putOI: number;
  putIV: number;
}

export interface OptionsChainSnapshot {
  underlyingSymbol: string;     // 'NIFTY' | 'BANKNIFTY' | 'RELIANCE'
  underlyingPrice: number;
  expiryDate: string;
  totalCallOI: number;
  totalPutOI: number;
  pcr: number;                   // Put-Call Ratio (totalPutOI / totalCallOI)
  maxPainStrike: number;
  averageIV: number;
  ivRank: number;                // 0–100 percentile
  strikes: OptionStrike[];
}

export interface OptionsBiasAnalysis {
  pcr: number;
  pcrBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  ivRank: number;
  ivRegime: 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'NORMAL';
  maxPainStrike: number;
  distanceToMaxPainPct: number;
  isAlignedWithSignal: boolean;
  veto: boolean;
  vetoReason?: string;
  confidenceAdjustmentPct: number; // ±10% adjustment
}

export class OptionsChainAnalytics {
  private chainSnapshots = new Map<string, OptionsChainSnapshot>();

  /**
   * Update options chain snapshot for an index or stock.
   */
  updateSnapshot(snapshot: OptionsChainSnapshot): void {
    this.chainSnapshots.set(snapshot.underlyingSymbol.toUpperCase(), snapshot);
  }

  /**
   * Evaluates Options Market Bias for a symbol and signal direction.
   */
  evaluateBias(symbol: string, signalDirection: 'LONG' | 'SHORT', currentPrice: number): OptionsBiasAnalysis {
    // Default fallback to index 'NIFTY' if specific symbol option chain not present
    const key = this.chainSnapshots.has(symbol.toUpperCase()) ? symbol.toUpperCase() : 'NIFTY';
    const snapshot = this.chainSnapshots.get(key);

    if (!snapshot) {
      // Default neutral analysis if no options data available
      return {
        pcr: 1.0,
        pcrBias: 'NEUTRAL',
        ivRank: 50,
        ivRegime: 'NORMAL',
        maxPainStrike: currentPrice,
        distanceToMaxPainPct: 0,
        isAlignedWithSignal: true,
        veto: false,
        confidenceAdjustmentPct: 0,
      };
    }

    const pcr = snapshot.pcr;
    const pcrBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      pcr >= 1.2 ? 'BULLISH' : pcr <= 0.7 ? 'BEARISH' : 'NEUTRAL';

    const ivRank = snapshot.ivRank;
    const ivRegime: 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'NORMAL' =
      ivRank >= 70 ? 'HIGH_VOLATILITY' : ivRank <= 30 ? 'LOW_VOLATILITY' : 'NORMAL';

    const maxPain = snapshot.maxPainStrike;
    const distanceToMaxPainPct = ((maxPain - currentPrice) / currentPrice) * 100;

    // Alignment check
    const isAlignedWithSignal =
      (signalDirection === 'LONG' && pcrBias !== 'BEARISH') ||
      (signalDirection === 'SHORT' && pcrBias !== 'BULLISH');

    // Veto check: extremely low PCR (<0.55) vetoes LONG; extremely high PCR (>1.6) vetoes SHORT
    let veto = false;
    let vetoReason: string | undefined;

    if (signalDirection === 'LONG' && pcr < 0.55) {
      veto = true;
      vetoReason = `Options PCR is extremely bearish (${pcr.toFixed(2)} < 0.55). Heavy call writing wall overhead. LONG signal vetoed.`;
    } else if (signalDirection === 'SHORT' && pcr > 1.6) {
      veto = true;
      vetoReason = `Options PCR is extremely bullish (${pcr.toFixed(2)} > 1.6). Heavy put writing floor beneath. SHORT signal vetoed.`;
    }

    const confidenceAdjustmentPct = veto ? -100 : isAlignedWithSignal ? 10 : -10;

    return {
      pcr,
      pcrBias,
      ivRank,
      ivRegime,
      maxPainStrike: maxPain,
      distanceToMaxPainPct: Math.round(distanceToMaxPainPct * 100) / 100,
      isAlignedWithSignal,
      veto,
      vetoReason,
      confidenceAdjustmentPct,
    };
  }

  /**
   * Helper: Calculates Max Pain Strike from a list of option strikes.
   * Strike price where total value of expiring options (calls + puts) is minimized.
   */
  static calculateMaxPain(strikes: OptionStrike[]): number {
    if (strikes.length === 0) return 0;

    let minLoss = Infinity;
    let maxPainStrike = strikes[0].strikePrice;

    for (const testStrike of strikes) {
      let totalLoss = 0;
      for (const strike of strikes) {
        // Call loss if spot > strike
        if (testStrike.strikePrice > strike.strikePrice) {
          totalLoss += (testStrike.strikePrice - strike.strikePrice) * strike.callOI;
        }
        // Put loss if spot < strike
        if (testStrike.strikePrice < strike.strikePrice) {
          totalLoss += (strike.strikePrice - testStrike.strikePrice) * strike.putOI;
        }
      }

      if (totalLoss < minLoss) {
        minLoss = totalLoss;
        maxPainStrike = testStrike.strikePrice;
      }
    }

    return maxPainStrike;
  }
}
