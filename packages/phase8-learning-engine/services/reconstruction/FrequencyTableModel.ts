/**
 * phase8/services/reconstruction/FrequencyTableModel.ts
 * Source: phase8-model-artifact-persistence-v1.md §2, §5 (Step 5/6 of reconstruction flow)
 *
 * FREQUENCY_TABLE: stores a single win-rate lookup value per ModelKey. No
 * feature weights — predict() ignores its input and returns the stored
 * win_probability directly. Appropriate for low-sample-size ModelKeys.
 */
import type { ISignalQualityModel, IWinRateProvider } from '../../phase5/contracts';
import type { ModelKey } from '../../domain/types';

export interface FrequencyTablePayload {
  model_key: ModelKey;
  win_probability: number;
  kelly_win_rate: number;
  sample_size: number;
}

export class FrequencyTableModel implements ISignalQualityModel, IWinRateProvider {
  readonly isReady = true;
  readonly source = 'PHASE8_LIVE_CALIBRATED';

  constructor(private readonly payload: FrequencyTablePayload) {}

  /** Ignores features entirely — this format has no per-feature weighting. */
  predict(_features: Record<string, number>): number {
    return this.payload.win_probability;
  }

  /** signalType/regime are part of the ModelKey this instance was built for; ignored here. */
  getWinRate(_signalType: string, _regime: string): number {
    return this.payload.kelly_win_rate;
  }
}
