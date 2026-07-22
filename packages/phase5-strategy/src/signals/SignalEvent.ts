/**
 * packages/phase5-strategy/src/signals/SignalEvent.ts
 * Artha AI — Signal Event contract emitted by the Signal Engine
 */

import { SessionStatus } from './MarketSessionGuard';

export type SignalDirection = 'LONG' | 'SHORT';
export type SignalStrength  = 'WEAK' | 'MODERATE' | 'STRONG';

export interface SignalEvent {
  readonly signal_id:   string;        // UUID
  readonly symbol:      string;
  readonly exchange:    'NSE' | 'BSE';
  readonly direction:   SignalDirection;
  readonly strength:    SignalStrength;

  readonly confidence:  number;        // 0–100
  readonly entry_price: number;        // LTP at signal time
  readonly stop_loss:   number;        // ATR-based stop
  readonly take_profit: number;        // 2× ATR target

  // Indicator snapshot at emission time
  readonly rsi:         number;
  readonly macd_hist:   number;
  readonly atr:         number;
  readonly ema20:       number;
  readonly ema50:       number;

  // Market Regime Context
  readonly regime?:             string;        // MarketRegimeLabel
  readonly regime_confidence?:  number;        // 0-100

  // Position Sizing & Risk Context
  readonly recommended_qty?:    number;        // Risk & Volatility sized quantity
  readonly risk_amount?:        number;        // Rupee risk at stop loss
  readonly kelly_fraction?:     number;        // Quarter-Kelly fraction

  // Market Session Context
  readonly session_status?:     SessionStatus; // NSE session at signal emission

  // Phase 18: Sentiment Fusion — news-adjusted confidence metadata
  readonly sentiment_score?:        number;   // -1 to +1 aggregate news sentiment
  readonly sentiment_direction?:    'ALIGNED' | 'COUNTER' | 'NEUTRAL';
  readonly sentiment_news_count?:   number;   // # of news items used in fusion

  readonly emitted_at:  Date;
  readonly bar_ts:      Date;          // candle bucket timestamp
}
