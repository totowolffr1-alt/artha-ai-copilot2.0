/**
 * phase8/services/ModelRegistry.ts
 * Implements: IModelRegistry (phase8-contracts-v1.md §3.5)
 * Enforces: I-01 (exactly one CURRENT ModelVersion per ModelKey at any time)
 * Source: phase8-domain-model-v1.md §2.2, §4.2, §7 (I-01); phase8-contracts-v1.md §3.5
 *
 * App-layer orchestration below sequences supersede-then-activate. True I-01
 * guarantee is the DB partial unique index (model_key_hash) WHERE status='CURRENT'
 * (phase8-persistence-design-v1.md §4.2) — this class cannot itself guarantee
 * atomicity across two separate repository calls without a DB transaction. If the
 * concrete IModelVersionRepository implementation exposes a transaction/unit-of-work
 * wrapper, both updateStatus() calls in activate() should run inside it. Absent
 * that, the DB index is the backstop: a concurrent racing activate() will fail on
 * INSERT/UPDATE conflict rather than silently producing two CURRENT rows.
 */
import type { IModelRegistry } from '../contracts/IModelRegistry';
import type { IModelVersionRepository } from '../repositories/IModelVersionRepository';
import type { ModelVersionDTO } from '../dtos/outputs';
import type { ModelKey, ModelVersionId } from '../domain/types';
import {
  DuplicateModelVersionError,
  ModelVersionNotFoundError,
  InvalidModelActivationStateError,
  UnreliableModelActivationError,
  OrphanedSupersessionError,
} from '../errors/Phase8Error';

export class ModelRegistry implements IModelRegistry {
  constructor(private readonly modelVersionRepo: IModelVersionRepository) {}

  /**
   * Register a newly TRAINED ModelVersion. Does not activate it.
   * Throws DuplicateModelVersionError if model_version_id already exists.
   */
  async register(model: ModelVersionDTO): Promise<void> {
    const existing = await this.modelVersionRepo.findById(model.model_version_id);
    if (existing !== null) {
      throw new DuplicateModelVersionError(model.model_version_id);
    }
    await this.modelVersionRepo.save(model);
  }

  /**
   * Activate a TRAINED ModelVersion for its ModelKey.
   * Atomically (see class docstring) transitions the existing CURRENT version
   * for this ModelKey — if any — to SUPERSEDED, then transitions the target
   * from TRAINED to CURRENT. Enforces I-01.
   */
  async activate(model_version_id: ModelVersionId): Promise<void> {
    const target = await this.modelVersionRepo.findById(model_version_id);
    if (target === null) {
      throw new ModelVersionNotFoundError(model_version_id);
    }
    if (target.status !== 'TRAINED') {
      throw new InvalidModelActivationStateError(model_version_id, target.status);
    }
    if (!target.is_ready) {
      // I-03: only reliable, TRAINED models may be injected/activated.
      throw new UnreliableModelActivationError(model_version_id);
    }

    const priorCurrent = await this.modelVersionRepo.findCurrent(target.model_key);
    const now = new Date();

    if (priorCurrent !== null && priorCurrent.model_version_id !== model_version_id) {
      await this.modelVersionRepo.updateStatus(priorCurrent.model_version_id, 'SUPERSEDED', {
        superseded_at: now,
      });

      try {
        await this.modelVersionRepo.updateStatus(model_version_id, 'CURRENT', {
          activated_at: now,
        });
      } catch (err) {
        // Prior CURRENT was already superseded but the replacement failed to
        // activate — I-01 would be violated (zero CURRENT for this ModelKey).
        // Surface distinctly so callers know to retrain/retry rather than
        // silently leaving the ModelKey without an active model.
        throw new OrphanedSupersessionError(target.model_key);
      }
      return;
    }

    // No existing CURRENT (first version for this ModelKey) — plain activation.
    await this.modelVersionRepo.updateStatus(model_version_id, 'CURRENT', {
      activated_at: now,
    });
  }

  async getCurrent(model_key: ModelKey): Promise<ModelVersionDTO | null> {
    return this.modelVersionRepo.findCurrent(model_key);
  }

  /**
   * Returns all ModelVersions for the given ModelKey, ordered by trained_at DESC.
   * Backed by findHistoryByModelKey — see IModelVersionRepository.PATCH.md
   * (additive method required for this to be implementable at all; not present
   * in the original contracts §4.2 interface).
   */
  async getHistory(model_key: ModelKey): Promise<ModelVersionDTO[]> {
    return this.modelVersionRepo.findHistoryByModelKey(model_key);
  }

  async getAllCurrentForRun(strategy_run_id: string): Promise<ModelVersionDTO[]> {
    return this.modelVersionRepo.findAllCurrentForStrategyRun(strategy_run_id);
  }
}
