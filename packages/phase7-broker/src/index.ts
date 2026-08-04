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

// Adapters — all supported brokers
export * from './adapters/PaperBrokerAdapter';
export * from './adapters/LiveBrokerAdapterMock';
export * from './adapters/AngelOneBrokerAdapter';
export * from './adapters/AngelOneAuthManager';
export * from './adapters/UpstoxBrokerAdapter';
export * from './adapters/ZerodhaBrokerAdapter';
export * from './adapters/FyersBrokerAdapter';
export * from './adapters/DhanBrokerAdapter';
export * from './adapters/ShoonyaBrokerAdapter';

// Universal Factory — use this everywhere
export * from './adapters/BrokerFactory';

