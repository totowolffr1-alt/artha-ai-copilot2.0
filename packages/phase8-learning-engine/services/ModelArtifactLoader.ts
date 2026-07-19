/**
 * phase8/services/ModelArtifactLoader.ts
 * Implements: IModelArtifactLoader (phase8-contracts-v1.md §3.10)
 * Source: phase8-model-artifact-persistence-v1.md §4, §5, §7
 *
 * Bridges serialised model_versions artifact columns to live ISignalQualityModel /
 * IWinRateProvider objects. Called only at injection time (pre-market window),
 * never per signal evaluation (persistence doc §4).
 */
import { createHash } from 'crypto';
import type { IModelArtifactLoader, ReconstructedModelDTO } from '../contracts/IModelArtifactLoader';
import type { IModelVersionRepository } from '../repositories/IModelVersionRepository';
import type { ModelArtifactDTO } from '../dtos/outputs';
import type { ModelVersionId, ArtifactFormat } from '../domain/types';
import {
  ArtifactNotFoundError,
  ArtifactChecksumError,
  ArtifactFormatError,
} from '../errors/Phase8Error';
import { FrequencyTableModel, type FrequencyTablePayload } from './reconstruction/FrequencyTableModel';
import { LinearWeightsModel, type LinearWeightsPayload } from './reconstruction/LinearWeightsModel';

interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export class ModelArtifactLoader implements IModelArtifactLoader {
  constructor(
    private readonly modelVersionRepo: IModelVersionRepository,
    private readonly logger: Logger
  ) {}

  /**
   * Load, validate, and reconstruct a ModelVersion's artifact into live model
   * objects. Steps per persistence-design §5:
   *   1. Fetch the model_versions row.
   *   2/3. Recompute SHA-256 checksum, compare to stored artifact_checksum.
   *   4. Deserialise per artifact_format.
   *   5/6. Construct ISignalQualityModel + IWinRateProvider.
   *   7. Return ReconstructedModelDTO.
   */
  async load(model_version_id: ModelVersionId): Promise<ReconstructedModelDTO> {
    this.logger.info('ModelArtifactLoader.load: starting', { model_version_id });

    // Step 1 — fetch.
    const version = await this.modelVersionRepo.findById(model_version_id);
    if (version === null) {
      this.logger.error('ModelArtifactLoader.load: no artifact row found', { model_version_id });
      throw new ArtifactNotFoundError(model_version_id);
    }

    const artifact: ModelArtifactDTO = {
      model_version_id: version.model_version_id,
      artifact_format: version.artifact_format,
      artifact_payload: version.artifact_payload,
      artifact_checksum: version.artifact_checksum,
      stored_at: version.trained_at ?? new Date(),
    };

    // Steps 2/3 — checksum validation. Re-verified here even though save()
    // already validated it once, to catch DB-level corruption between write
    // and read (persistence-design §7, "When validated" #2).
    if (!this.validateChecksum(artifact)) {
      const actual = this.computeChecksum(artifact.artifact_payload);
      this.logger.error('ModelArtifactLoader.load: checksum mismatch — CRITICAL', {
        model_version_id,
        expected: artifact.artifact_checksum,
        actual,
      });
      throw new ArtifactChecksumError(model_version_id, artifact.artifact_checksum, actual);
    }

    // Step 4/5/6 — deserialise + construct live objects, dispatched on format.
    const reconstructed = this.reconstruct(artifact);

    this.logger.info('ModelArtifactLoader.load: reconstruction succeeded', {
      model_version_id,
      artifact_format: artifact.artifact_format,
    });

    // Step 7.
    return {
      model_version_id: version.model_version_id,
      model_key: version.model_key,
      artifact_format: artifact.artifact_format,
      signal_quality_model: reconstructed.signal_quality_model,
      win_rate_provider: reconstructed.win_rate_provider,
    };
  }

  /**
   * Validate checksum without full reconstruction. Called by
   * IModelVersionRepository.save() before persist (persistence-design §7,
   * "When validated" #1) — pure, no I/O, safe to call synchronously.
   */
  validateChecksum(artifact: ModelArtifactDTO): boolean {
    const actual = this.computeChecksum(artifact.artifact_payload);
    return actual === artifact.artifact_checksum;
  }

  // ---- internal helpers ----

  private computeChecksum(payload: Record<string, unknown>): string {
    // JSON.stringify(value, null, 0) — compact, no whitespace. Persistence
    // doc §7: "sufficient for checksum stability ... single PostgreSQL/Node.js stack."
    const serialised = JSON.stringify(payload, null, 0);
    return createHash('sha256').update(serialised).digest('hex');
  }

  private reconstruct(artifact: ModelArtifactDTO): {
    signal_quality_model: FrequencyTableModel | LinearWeightsModel;
    win_rate_provider: FrequencyTableModel | LinearWeightsModel;
  } {
    switch (artifact.artifact_format as ArtifactFormat) {
      case 'FREQUENCY_TABLE': {
        const payload = artifact.artifact_payload as unknown as FrequencyTablePayload;
        const model = new FrequencyTableModel(payload);
        return { signal_quality_model: model, win_rate_provider: model };
      }
      case 'LINEAR_WEIGHTS': {
        const payload = artifact.artifact_payload as unknown as LinearWeightsPayload;
        const model = new LinearWeightsModel(payload);
        return { signal_quality_model: model, win_rate_provider: model };
      }
      default: {
        this.logger.error('ModelArtifactLoader.reconstruct: unrecognised artifact_format', {
          model_version_id: artifact.model_version_id,
          artifact_format: artifact.artifact_format,
        });
        throw new ArtifactFormatError(artifact.model_version_id, String(artifact.artifact_format));
      }
    }
  }
}
