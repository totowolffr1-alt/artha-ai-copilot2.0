/**
 * packages/phase6-tradingview/src/errors.ts
 * Artha AI — Phase 6 Risk Engine
 */

export class RiskEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class CircuitBreakerTrippedError extends RiskEngineError {
  constructor(reason: string) {
    super(`Circuit breaker tripped: ${reason}`);
  }
}

export class MarketCrashBlockError extends RiskEngineError {
  constructor(reason: string) {
    super(`Market crash block active: ${reason}`);
  }
}

export class InvalidConfigError extends RiskEngineError {
  constructor(message: string) {
    super(`Invalid risk configuration: ${message}`);
  }
}

export class CacheMissError extends RiskEngineError {
  constructor(key: string) {
    super(`Cache miss: ${key} not present or uninitialized`);
  }
}

export class CacheExpiredError extends RiskEngineError {
  constructor(key: string, ageMs: number) {
    super(`Cache expired: ${key} is too old (${ageMs}ms)`);
  }
}
