/**
 * phase8/contracts/IModelArtifactLoader.ts
 * Source: phase8-contracts-v1.md §3.10
 */
import type { ArtifactFormat, ModelKey, ModelVersionId } from '../domain/types';
import type { ModelArtifactDTO } from '../dtos/outputs';
import type { ISignalQualityModel, IWinRateProvider } from '../phase5/contracts';

// NOTE: ArtifactNotFoundError / ArtifactChecksumError / ArtifactFormatError
// live in ../errors/Phase8Error.ts (existing code imports them from there,
// not from this contract file) — see errors/Phase8Error.ts.

export interface IModelArtifactLoader {
  load(model_version_id: ModelVersionId): Promise<ReconstructedModelDTO>;
  validateChecksum(artifact: ModelArtifactDTO): boolean;
}

export interface ReconstructedModelDTO {
  readonly model_version_id: ModelVersionId;
  readonly model_key: ModelKey;
  readonly artifact_format: ArtifactFormat;
  readonly signal_quality_model: ISignalQualityModel;
  readonly win_rate_provider: IWinRateProvider;
}
