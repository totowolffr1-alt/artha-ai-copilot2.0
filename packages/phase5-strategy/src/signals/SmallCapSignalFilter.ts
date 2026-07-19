import { SignalEvent } from './SignalEvent';

export interface ISmallCapUniverseChecker {
  isSmallCap(symbol: string): boolean;
  getCircuitLimitPct(symbol: string): number;
}

export class SmallCapSignalFilter {
  constructor(private readonly universeLoader: ISmallCapUniverseChecker) {}

  /**
   * Filter signal events:
   * Only allows the signal if it's a small-cap stock.
   */
  filter(signal: SignalEvent): { allowed: boolean; reason?: string } {
    if (!this.universeLoader.isSmallCap(signal.symbol)) {
      return { allowed: false, reason: `NOT_SMALL_CAP: Symbol ${signal.symbol} is not in the small-cap universe.` };
    }

    const circuitLimit = this.universeLoader.getCircuitLimitPct(signal.symbol);
    if (circuitLimit <= 5) {
      // 5% circuit limits indicate extreme liquidity risk/suspension risk
      return { allowed: false, reason: `HIGH_RISK_CIRCUIT: Circuit limit is too narrow (${circuitLimit}%)` };
    }

    return { allowed: true };
  }
}
