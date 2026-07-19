/**
 * phase8/services/reconstruction/LinearWeightsModel.ts
 * Source: phase8-model-artifact-persistence-v1.md §2, §5 (Step 5/6 of reconstruction flow)
 *
 * LINEAR_WEIGHTS: stores a feature weight vector keyed on FeatureVectorDTO.features
 * map keys. predict() computes sigmoid(Σ weights[k] * features[k] + intercept).
 * Requires sample_size >= MIN_SAMPLE_SIZE at training time (IModelTrainer's
 * responsibility — this class just reconstructs whatever was trained).
 */
import type { ISignalQualityModel, IWinRateProvider } from '../../phase5/contracts';
import type { ModelKey } from '../../domain/types';

export interface LinearWeightsPayload {
  model_key: ModelKey;
  feature_weights: Record<string, number>;
  intercept: number;
  kelly_win_rate: number;
  sample_size: number;
}

export class LinearWeightsModel implements ISignalQualityModel, IWinRateProvider {
  readonly isReady = true;
  readonly source = 'PHASE8_LIVE_CALIBRATED';

  constructor(private readonly payload: LinearWeightsPayload) {}

  /**
   * sigmoid(Σ weights[k] * features[k] + intercept).
   * Missing feature keys contribute 0 (features[k] ?? 0) rather than throwing —
   * a feature absent at predict time should degrade gracefully, not crash a
   * live signal evaluation path.
   */
  predict(features: Record<string, number>): number {
    const z = Object.entries(this.payload.feature_weights).reduce(
      (sum, [key, weight]) => sum + weight * (features[key] ?? 0),
      this.payload.intercept
    );
    return sigmoid(z);
  }

  getWinRate(_signalType: string, _regime: string): number {
    return this.payload.kelly_win_rate;
  }
}

/** sigmoid(-Inf) -> 0, sigmoid(+Inf) -> 1, sigmoid(0) = 0.5. Never NaN for finite z. */
function sigmoid(z: number): number {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  return 1 / (1 + Math.exp(-z));
}
