/**
 * packages/phase10-copilot-intelligence/src/types.ts
 * Artha AI — Phase 10 Core Types
 */

// ─── Market Regime (mirrors Phase 6) ────────────────────────
export type MarketRegime =
  | 'STRONG_BULL'
  | 'BULL'
  | 'NEUTRAL'
  | 'CAUTION'
  | 'HIGH_VOLATILITY'
  | 'CRASH';

// ─── Signal Direction ────────────────────────────────────────
export type SignalDirection = 'LONG' | 'SHORT';

// ─── Copilot Confidence Band ─────────────────────────────────
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

// ─── Raw opportunity data fetched from DB ───────────────────
export interface RawOpportunity {
  signal_id:       string;
  symbol:          string;
  direction:       SignalDirection;
  signal_confidence: number;       // 0–1 from Phase 6
  regime:          MarketRegime;
  portfolio_heat:  number;         // 0–1
  vix_level:       number;
  learned_win_rate: number;        // 0–1 from Phase 8
  kill_switch_active: boolean;     // from Phase 9
  atr:             number;
  rsi:             number;
  macd:            number;
  macd_signal:     number;
  bb_upper:        number;
  bb_lower:        number;
  ltp:             number;         // last traded price
  kelly_qty:       number;         // Phase 6 sized quantity
  stop_price:      number;         // Phase 7 OCO stop
  target_price:    number;         // Phase 7 OCO target
  signal_created_at: Date;
}

// ─── Scored opportunity with copilot composite score ─────────
export interface ScoredOpportunity extends RawOpportunity {
  copilot_score:    number;         // 0–100
  confidence_band:  ConfidenceBand;
  brief:            string;         // plain-English one-liner
  detail_lines:     string[];       // breakdown lines for full notification
  should_notify:    boolean;
}

// ─── Live Position (for stop-hit monitoring) ─────────────────
export interface LivePosition {
  symbol:      string;
  direction:   SignalDirection;
  entry_price: number;
  stop_price:  number;
  target_price: number;
  qty:         number;
  ltp:         number;
  unrealised_pnl: number;
}

// ─── Notification Channel Interface ──────────────────────────
export interface INotificationChannel {
  send(alert: CopilotAlert): Promise<void>;
}

// ─── Copilot Alert payload ────────────────────────────────────
export type AlertType =
  | 'OPPORTUNITY'
  | 'RISK_WARNING'
  | 'STOP_HIT'
  | 'KILL_SWITCH'
  | 'DAILY_DIGEST'
  | 'WEEKLY_DIGEST'
  | 'SYSTEM_STATUS';

export interface CopilotAlert {
  type:      AlertType;
  title:     string;
  body:      string;
  symbol?:   string;
  urgency:   'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: Date;
}

// ─── Conversation message ─────────────────────────────────────
export interface ConversationMessage {
  role:      'user' | 'copilot';
  text:      string;
  timestamp: Date;
}

// ─── Query intent types ───────────────────────────────────────
export type QueryIntent =
  | 'WHY_REJECTED'
  | 'DRAWDOWN_STATUS'
  | 'OPEN_POSITIONS'
  | 'DAILY_SUMMARY'
  | 'SUPPRESSED_SIGNALS'
  | 'WIN_RATE'
  | 'REGIME_STATUS'
  | 'WATCHLIST_ADD'
  | 'WATCHLIST_REMOVE'
  | 'UNKNOWN';
