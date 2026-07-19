/**
 * packages/phase6-tradingview/src/risk/SmallCapRiskProfile.ts
 * Artha AI — Phase 6 Small-Cap Risk Profile
 *
 * Provides specialized multipliers and thresholds for small cap stocks,
 * protecting personal account funds against extreme volatility and low liquidity.
 * Supports both INTRADAY (MIS) and SWING (CNC) profiles.
 */

export type SmallCapTier = 'SMALLCAP_100' | 'SMALLCAP_250' | 'MIDCAP_100' | 'LARGECAP';
export type TradingMode = 'INTRADAY' | 'SWING';

export interface RiskMultipliers {
  bull: number;
  neutral: number;
  volatile: number;
}

export class SmallCapRiskProfile {
  // Tighter ATR multipliers for Intraday trading to protect capital
  private static readonly INTRADAY_MULTIPLIERS: Record<SmallCapTier, RiskMultipliers> = {
    SMALLCAP_100: { bull: 2.8, neutral: 1.8, volatile: 3.5 },
    SMALLCAP_250: { bull: 3.2, neutral: 2.0, volatile: 4.0 },
    MIDCAP_100:   { bull: 2.5, neutral: 1.6, volatile: 3.2 },
    LARGECAP:     { bull: 2.2, neutral: 1.3, volatile: 2.8 },
  };

  // Wider ATR multipliers for Swing trading to avoid noise stop-outs over days
  private static readonly SWING_MULTIPLIERS: Record<SmallCapTier, RiskMultipliers> = {
    SMALLCAP_100: { bull: 3.5, neutral: 2.5, volatile: 4.5 },
    SMALLCAP_250: { bull: 4.0, neutral: 3.0, volatile: 5.0 },
    MIDCAP_100:   { bull: 3.0, neutral: 2.0, volatile: 3.8 },
    LARGECAP:     { bull: 2.5, neutral: 1.8, volatile: 3.2 },
  };

  private static readonly MIN_DAILY_VOLUME: Record<SmallCapTier, number> = {
    SMALLCAP_100: 50_000,
    SMALLCAP_250: 25_000,
    MIDCAP_100:   200_000,
    LARGECAP:     1_000_000,
  };

  /**
   * Get the ATR multiplier based on small-cap tier, current market volatility state, and trading mode.
   */
  static getAtrMultiplier(
    mode: TradingMode,
    tier: SmallCapTier,
    isVolatile: boolean,
    isBull: boolean
  ): number {
    const maps = mode === 'SWING' ? this.SWING_MULTIPLIERS : this.INTRADAY_MULTIPLIERS;
    const multipliers = maps[tier] || maps.LARGECAP;
    if (isVolatile) return multipliers.volatile;
    if (isBull) return multipliers.bull;
    return multipliers.neutral;
  }

  /**
   * Get minimum required average daily volume (shares) to allow trading.
   */
  static getMinDailyVolume(tier: SmallCapTier): number {
    return this.MIN_DAILY_VOLUME[tier] || this.MIN_DAILY_VOLUME.LARGECAP;
  }

  /**
   * Enforce order size cap relative to average daily volume.
   * Order quantity should not exceed 1% of average daily volume to prevent market impact.
   */
  static isOrderSizeSafe(qty: number, avgDailyVolume: number): boolean {
    if (avgDailyVolume <= 0) return false;
    return qty <= avgDailyVolume * 0.01;
  }

  /**
   * Minimum average daily turnover value (Volume * Close) for Swing trades.
   * Blocks entries if 20-day average turnover is under ₹10 Lakhs (1,000,000 INR).
   */
  static isSwingLiquiditySafe(avgVolume: number, closePrice: number): boolean {
    const avgDailyTurnover = avgVolume * closePrice;
    return avgDailyTurnover >= 1_000_000;
  }
}
