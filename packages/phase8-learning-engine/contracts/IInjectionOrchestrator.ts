/**
 * phase8/contracts/IInjectionOrchestrator.ts
 * Source: phase8-contracts-v1.md §3.8
 */
import type { InjectionPayloadDTO, InjectionResultDTO } from '../dtos/outputs';
import type { ISignalQualityModel, IWinRateProvider } from '../phase5/contracts';

export interface IInjectionOrchestrator {
  assemble(strategy_run_id: string): Promise<InjectionPayloadDTO | null>;

  deliver(
    payload: InjectionPayloadDTO,
    signalEngine: { setQualityModel: (m: ISignalQualityModel) => void },
    kellyCalculator: { setWinRateProvider: (p: IWinRateProvider) => void }
  ): Promise<InjectionResultDTO>;
}
