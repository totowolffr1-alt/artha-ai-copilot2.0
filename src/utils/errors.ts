/**
 * src/utils/errors.ts
 * Phase 2B — Result<T> primitive + full error hierarchy.
 * No exceptions cross module boundaries. Every fallible op returns Result<T>.
 */

// ─── Result<T> ───────────────────────────────────────────────────────────────

export type Result<T> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: MarketDataError };

export const ok  = <T>(value: T): Result<T>               => ({ ok: true,  value });
export const err = <T>(error: MarketDataError): Result<T>  => ({ ok: false, error });

// ─── Error discriminated union ────────────────────────────────────────────────

export type MarketDataError =
  | ValidationError
  | NetworkError
  | AuthError
  | NormalizationError
  | SubscriptionError
  | HistoricalDataError
  | ConnectionError
  | TimeoutError
  | UnknownError;

// ─── Error shapes ─────────────────────────────────────────────────────────────

export interface ValidationError {
  readonly type:    'ValidationError';
  readonly field:   string;     // e.g. "price", "high"
  readonly rule:    string;     // e.g. "isFinite", "high >= low"
  readonly actual:  unknown;
  readonly message: string;
  readonly cause?:  Error;
}

export interface NetworkError {
  readonly type:        'NetworkError';
  readonly statusCode?: number;
  readonly endpoint?:   string;
  readonly message:     string;
  readonly cause?:      Error;
}

export interface AuthError {
  readonly type:    'AuthError';
  readonly reason:  'expired_token' | 'invalid_credentials' | 'missing_totp' | 'unknown';
  readonly message: string;
  readonly cause?:  Error;
}

export interface NormalizationError {
  readonly type:     'NormalizationError';
  readonly rawField: string;
  readonly rawValue: unknown;
  readonly message:  string;
  readonly cause?:   Error;
}

export interface SubscriptionError {
  readonly type:    'SubscriptionError';
  readonly symbol:  string;
  readonly message: string;
  readonly cause?:  Error;
}

export interface HistoricalDataError {
  readonly type:      'HistoricalDataError';
  readonly symbol:    string;
  readonly timeframe: string;
  readonly fromMs:    number;
  readonly toMs:      number;
  readonly message:   string;
  readonly cause?:    Error;
}

export interface ConnectionError {
  readonly type:        'ConnectionError';
  readonly adapterName: string;
  readonly attempt:     number;
  readonly message:     string;
  readonly cause?:      Error;
}

export interface TimeoutError {
  readonly type:      'TimeoutError';
  readonly operation: string;
  readonly timeoutMs: number;
  readonly message:   string;
  readonly cause?:    Error;
}

export interface UnknownError {
  readonly type:    'UnknownError';
  readonly message: string;
  readonly cause?:  Error;
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export const isValidationError    = (e: MarketDataError): e is ValidationError    => e.type === 'ValidationError';
export const isNetworkError       = (e: MarketDataError): e is NetworkError        => e.type === 'NetworkError';
export const isAuthError          = (e: MarketDataError): e is AuthError           => e.type === 'AuthError';
export const isNormalizationError = (e: MarketDataError): e is NormalizationError  => e.type === 'NormalizationError';
export const isConnectionError    = (e: MarketDataError): e is ConnectionError     => e.type === 'ConnectionError';
export const isHistoricalError    = (e: MarketDataError): e is HistoricalDataError => e.type === 'HistoricalDataError';
