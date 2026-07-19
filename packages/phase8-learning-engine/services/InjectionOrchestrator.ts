/**
 * phase8/services/InjectionOrchestrator.ts
 * Implements: IInjectionOrchestrator (phase8-contracts-v1.md §3.8)
 * Source: phase8-runtime-flow-v1.md §3.2 (pre-market injection sequence), §9.3 (KillSwitch gate)
 *         phase8-model-artifact-persistence-v1.md §5, §7 (reconstruction + checksum handling)
 *         phase8-implementation-roadmap-v1.md Step 14 (INJECTION_TIMEOUT_MS, B-03)
 *
 * Assembles InjectionPayloadDTO from CURRENT ModelVersions, loads+validates each
 * artifact, and delivers reconstructed models to Phase 5. Does NOT call
 * ModelRegistry.activate() itself — per runtime-flow §3.2, activation happens
 * in the calling LearningEngine after deliver() succeeds, one level up from
 * this module's responsibility.
 */
import type { IInjectionOrchestrator } from '../contracts/IInjectionOrchestrator';
import type { IModelRegistry } from '../contracts/IModelRegistry';
import type { IModelArtifactLoader } from '../contracts/IModelArtifactLoader';
import type { ISystemStateReader } from './ISystemStateReader';
import type {
  InjectionPayloadDTO,
  InjectionResultDTO,
  ModelVersionDTO,
} from '../dtos/outputs';
import type { ISignalQualityModel, IWinRateProvider } from '../phase5/contracts';
import type { ModelVersionId } from '../domain/types';
import {
  ArtifactNotFoundError,
  ArtifactChecksumError,
  ArtifactFormatError,
  InjectionTimeoutError,
  InjectionPartialError,
} from '../errors/Phase8Error';

/**
 * Implementation-defined per roadmap Step 14 note (resolves audit B-03 —
 * no value specified in the architecture). Configurable via env var so a
 * deployment can tune it without a code change.
 */
const DEFAULT_INJECTION_TIMEOUT_MS = 5000;
const INJECTION_TIMEOUT_MS = resolveInjectionTimeoutMs();

function resolveInjectionTimeoutMs(): number {
  const raw = process.env.PHASE8_INJECTION_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_INJECTION_TIMEOUT_MS;
  const parsed = Number(raw);
  // Guard against NaN/non-positive values — setTimeout(NaN, ...) fires
  // immediately in Node, silently turning "misconfigured" into "always times out".
  if (!Number.isFinite(parsed) || parsed <= 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `PHASE8_INJECTION_TIMEOUT_MS='${raw}' is not a valid positive number; ` +
      `falling back to default ${DEFAULT_INJECTION_TIMEOUT_MS}ms`
    );
    return DEFAULT_INJECTION_TIMEOUT_MS;
  }
  return parsed;
}

interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

type SignalEngineLike = { setQualityModel: (m: ISignalQualityModel) => void };
type KellyCalculatorLike = { setWinRateProvider: (p: IWinRateProvider) => void };

export class InjectionOrchestrator implements IInjectionOrchestrator {
  constructor(
    private readonly modelRegistry: IModelRegistry,
    private readonly artifactLoader: IModelArtifactLoader,
    private readonly systemStateReader: ISystemStateReader,
    private readonly logger: Logger
  ) {}

  /**
   * Build an InjectionPayloadDTO from all CURRENT ModelVersions for the run.
   * Returns null if none exist, or if none are reliable/ready — degraded mode
   * (runtime-flow §2.2) is the caller's responsibility to handle by skipping
   * injection entirely.
   */
  async assemble(strategy_run_id: string): Promise<InjectionPayloadDTO | null> {
    const allCurrent = await this.modelRegistry.getAllCurrentForRun(strategy_run_id);

    const ready = allCurrent.filter((v) => v.is_ready);
    const skipped = allCurrent.length - ready.length;
    if (skipped > 0) {
      this.logger.warn('InjectionOrchestrator.assemble: skipping unreliable CURRENT versions', {
        strategy_run_id,
        skipped_count: skipped,
      });
    }

    if (ready.length === 0) {
      this.logger.warn('InjectionOrchestrator.assemble: no CURRENT reliable models', {
        strategy_run_id,
      });
      return null;
    }

    return {
      strategy_run_id,
      assembled_at: new Date(),
      model_versions: ready,
    };
  }

  /**
   * Deliver the injection payload to Phase 5.
   *
   * Flow (runtime-flow §3.2, §9.3):
   *   1. KillSwitch gate — EMERGENCY_STOP skips injection entirely, no error.
   *   2. Per ModelVersion: load+validate artifact, reconstruct, then call
   *      setQualityModel()/setWinRateProvider() atomically (all-or-nothing).
   *      A checksum/format/not-found failure skips just that version and
   *      continues with the rest (fall back to whatever was already injected
   *      for that ModelKey) — logged CRITICAL, not fatal to the whole delivery.
   *      A timeout or partial per-version injection is fatal to the call.
   */
  async deliver(
    payload: InjectionPayloadDTO,
    signalEngine: SignalEngineLike,
    kellyCalculator: KellyCalculatorLike
  ): Promise<InjectionResultDTO> {
    const startedAt = Date.now();

    const killSwitchState = await this.systemStateReader.getKillSwitchState();
    if (killSwitchState === 'EMERGENCY_STOP') {
      this.logger.warn('InjectionOrchestrator.deliver: KillSwitch EMERGENCY_STOP — skipping injection', {
        strategy_run_id: payload.strategy_run_id,
      });
      return {
        strategy_run_id: payload.strategy_run_id,
        injected_at: new Date(),
        model_version_ids: [],
        injection_latency_ms: Date.now() - startedAt,
        quality_model_injected: false,
        win_rate_provider_injected: false,
      };
    }

    const deliveredVersionIds: ModelVersionId[] = [];
    let anyQualityModelInjected = false;
    let anyWinRateProviderInjected = false;

    for (const version of payload.model_versions) {
      let reconstructed;
      try {
        reconstructed = await this.withTimeout(
          this.artifactLoader.load(version.model_version_id),
          INJECTION_TIMEOUT_MS,
          payload.strategy_run_id
        );
      } catch (err) {
        if (
          err instanceof ArtifactChecksumError ||
          err instanceof ArtifactFormatError ||
          err instanceof ArtifactNotFoundError
        ) {
          // Skip this version only — fall back to whatever Phase 5 already
          // has for this ModelKey. Persistence doc §7: "log CRITICAL alert →
          // skip this model version → fall back to prior CURRENT."
          this.logger.error('InjectionOrchestrator.deliver: artifact load failed — CRITICAL, skipping version', {
            strategy_run_id: payload.strategy_run_id,
            model_version_id: version.model_version_id,
            error: err.message,
            code: err.code,
          });
          continue;
        }
        // InjectionTimeoutError or anything unexpected propagates — fatal to the call.
        throw err;
      }

      // "atomically per version (all-or-nothing per version)" — track both
      // injections for this version and detect a split outcome.
      let qualityInjectedThisVersion = false;
      let winRateInjectedThisVersion = false;
      try {
        signalEngine.setQualityModel(reconstructed.signal_quality_model);
        qualityInjectedThisVersion = true;
        kellyCalculator.setWinRateProvider(reconstructed.win_rate_provider);
        winRateInjectedThisVersion = true;
      } catch (err) {
        this.logger.error('InjectionOrchestrator.deliver: partial injection for version', {
          strategy_run_id: payload.strategy_run_id,
          model_version_id: version.model_version_id,
          quality_model_injected: qualityInjectedThisVersion,
          win_rate_provider_injected: winRateInjectedThisVersion,
        });
        throw new InjectionPartialError(
          qualityInjectedThisVersion,
          winRateInjectedThisVersion,
          err instanceof Error ? err.message : String(err)
        );
      }

      deliveredVersionIds.push(version.model_version_id);
      anyQualityModelInjected = anyQualityModelInjected || qualityInjectedThisVersion;
      anyWinRateProviderInjected = anyWinRateProviderInjected || winRateInjectedThisVersion;

      this.logger.info('InjectionOrchestrator.deliver: version delivered', {
        strategy_run_id: payload.strategy_run_id,
        model_version_id: version.model_version_id,
      });
    }

    const result: InjectionResultDTO = {
      strategy_run_id: payload.strategy_run_id,
      injected_at: new Date(),
      model_version_ids: deliveredVersionIds,
      injection_latency_ms: Date.now() - startedAt,
      quality_model_injected: anyQualityModelInjected,
      win_rate_provider_injected: anyWinRateProviderInjected,
    };

    this.logger.info('InjectionOrchestrator.deliver: finished', result as unknown as Record<string, unknown>);

    return result;
  }

  // ---- internal helpers ----

  /** Races a promise against INJECTION_TIMEOUT_MS; throws InjectionTimeoutError on timeout. */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, strategy_run_id: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new InjectionTimeoutError(strategy_run_id, timeoutMs));
      }, timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
