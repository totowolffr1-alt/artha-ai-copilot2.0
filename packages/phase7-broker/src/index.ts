/**
 * packages/phase7-broker/src/index.ts
 * Artha AI — Phase 7 Public Exports
 */

// Types
export * from './types/domain';
export * from './types/internal';

// Contracts
export * from './contracts/IBrokerAdapter';
export * from './contracts/IExecutionOrchestrator';

// Capital Protection
export * from './protection/TransactionCostFilter';
export * from './protection/SmartTrailingStop';

// State & Orchestrator
export * from './state/ExecutionStateMachine';
export * from './orchestrator/ExecutionOrchestrator';

// Adapters
export * from './adapters/PaperBrokerAdapter';
export * from './adapters/LiveBrokerAdapterMock';
export * from './adapters/AngelOneBrokerAdapter';
export * from './adapters/AngelOneAuthManager';
