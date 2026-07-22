/**
 * packages/phase5-strategy/src/signals/RegimeEngine.ts
 * Artha AI — Market Regime Classification Engine
 *
 * Evaluates IndicatorSnapshot (EMA20, EMA50, RSI14, MACD, ATR14, BB20)
 * to output deterministic regime classification:
 * TRENDING_UP | TRENDING_DOWN | SIDEWAYS | HIGH_VOLATILITY | LOW_VOLATILITY | WARMUP
 */

import { IndicatorSnapshot } from '../indicators/IndicatorPipeline';

export type MarketRegimeLabel =
  | 'TRENDING_UP'
  | 'TRENDING_DOWN'
  | 'SIDEWAYS'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'WARMUP';

export interface RegimeClassification {
  label: MarketRegimeLabel;
  confidence: number; // 0 to 100
  atrPct: number;     // ATR14 as percentage of price
  emaGapPct: number;  // (EMA20 - EMA50) / price * 100
  bbWidthPct: number; // Bollinger Bandwidth %
}

export class RegimeEngine {
  classify(snap: IndicatorSnapshot, close: number): RegimeClassification {
    // 1. Warmup Check
    if (
      isNaN(snap.ema50) ||
      isNaN(snap.rsi14) ||
      isNaN(snap.atr14) ||
      isNaN(snap.macd.histogram) ||
      isNaN(snap.bb20.middle)
    ) {
      return {
        label: 'WARMUP',
        confidence: 0,
        atrPct: 0,
        emaGapPct: 0,
        bbWidthPct: 0,
      };
    }

    const atrPct = (snap.atr14 / close) * 100;
    const emaGapPct = ((snap.ema20 - snap.ema50) / close) * 100;
    const bbWidthPct = snap.bb20.bandwidth * 100;

    // 2. High Volatility Regime Check (ATR % > 3.5% or BB Width > 15%)
    if (atrPct > 3.5 || bbWidthPct > 15.0) {
      const confidence = Math.min(100, Math.round(70 + (atrPct - 3.5) * 15));
      return {
        label: 'HIGH_VOLATILITY',
        confidence,
        atrPct,
        emaGapPct,
        bbWidthPct,
      };
    }

    // 3. Low Volatility / Squeeze Regime Check (ATR % < 0.4% or BB Width < 1.2%)
    if (atrPct < 0.4 || bbWidthPct < 1.2) {
      return {
        label: 'LOW_VOLATILITY',
        confidence: 85,
        atrPct,
        emaGapPct,
        bbWidthPct,
      };
    }

    // 4. Trending Up Regime Check (EMA20 > EMA50 and Price > EMA50)
    if (snap.ema20 > snap.ema50 && close > snap.ema50) {
      let confidence = 70;
      if (snap.rsi14 > 50 && snap.rsi14 < 70) confidence += 15;
      if (emaGapPct > 0.3) confidence += 15;
      return {
        label: 'TRENDING_UP',
        confidence: Math.min(100, confidence),
        atrPct,
        emaGapPct,
        bbWidthPct,
      };
    }

    // 5. Trending Down Regime Check (EMA20 < EMA50 and Price < EMA50)
    if (snap.ema20 < snap.ema50 && close < snap.ema50) {
      let confidence = 70;
      if (snap.rsi14 < 50 && snap.rsi14 > 30) confidence += 15;
      if (emaGapPct < -0.3) confidence += 15;
      return {
        label: 'TRENDING_DOWN',
        confidence: Math.min(100, confidence),
        atrPct,
        emaGapPct,
        bbWidthPct,
      };
    }

    // 6. Default to Sideways / Ranging Regime
    let sidewaysConf = 65;
    if (Math.abs(emaGapPct) < 0.2) sidewaysConf += 20;
    return {
      label: 'SIDEWAYS',
      confidence: Math.min(100, sidewaysConf),
      atrPct,
      emaGapPct,
      bbWidthPct,
    };
  }
}
