/**
 * packages/phase9-testing/src/guards/BrokerApiStalenessGuard.ts
 * Artha AI — Phase 9 Broker API Staleness Guard
 *
 * Implements H3 safety rules:
 *   - 3-tier age calculation.
 *   - configurable 30s staleness threshold.
 *   - 5s single retry spacing.
 *   - STALE_UNRESOLVABLE emergency halt.
 */

import { DataAgeTier, IAlertNotifier } from '../types';

export interface StalenessInput {
  lastUpdatedAt?: string; // ISO date string in payload (Tier 1)
  httpDateHeader?: string; // Date header in response (Tier 2)
  localFetchTime: number; // epoch ms (Tier 3 fallback)
}

export class BrokerApiStalenessGuard {
  constructor(
    private readonly alertNotifier: IAlertNotifier,
    private readonly stalenessThresholdMs: number = 30000 // default 30s
  ) {}

  /**
   * Assess the data age of a position payload.
   * Returns data age in ms and the Tier utilized.
   */
  assessAge(input: StalenessInput, now: number = Date.now()): { ageMs: number; tier: DataAgeTier } {
    // Tier 1: Body timestamp
    if (input.lastUpdatedAt) {
      const parsedTime = Date.parse(input.lastUpdatedAt);
      if (!isNaN(parsedTime)) {
        return { ageMs: Math.abs(now - parsedTime), tier: 'Tier 1' };
      }
    }

    // Tier 2: HTTP response Date header
    if (input.httpDateHeader) {
      const parsedTime = Date.parse(input.httpDateHeader);
      if (!isNaN(parsedTime)) {
        return { ageMs: Math.abs(now - parsedTime), tier: 'Tier 2' };
      }
    }

    // Tier 3: Local round-trip fetch time + 60s conservative buffer
    const ageMs = Math.abs(now - input.localFetchTime) + 60000;
    return { ageMs, tier: 'Tier 3' };
  }

  /**
   * Checks if data is stale. If stale, runs a retry hook once after a 5s delay.
   * If still stale, triggers STALE_UNRESOLVABLE.
   */
  async checkStaleness(
    fetchPayload: () => Promise<StalenessInput>,
    now: () => number = Date.now
  ): Promise<void> {
    let input = await fetchPayload();
    let assessment = this.assessAge(input, now());

    if (assessment.ageMs <= this.stalenessThresholdMs) {
      return; // Safe!
    }

    // Volatile data! Run single retry after 5s spacing
    await this.alertNotifier.sendAlert(`Stale position data detected (${assessment.ageMs}ms, ${assessment.tier}). Retrying in 5 seconds...`);
    await new Promise(r => setTimeout(r, 5000));

    input = await fetchPayload();
    assessment = this.assessAge(input, now());

    if (assessment.ageMs > this.stalenessThresholdMs) {
      await this.alertNotifier.sendAlert(`CRITICAL: Broker positions data age unresolved after retry. State: STALE_UNRESOLVABLE.`);
      throw new Error(`STALE_UNRESOLVABLE: positions age ${assessment.ageMs}ms exceeded threshold`);
    }
  }
}
