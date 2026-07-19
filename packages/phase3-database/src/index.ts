/**
 * packages/phase3-database/src/index.ts
 * Artha AI — Phase 3 Database Layer Exports
 */

// Export Types & DTOs
export * from './types/domain';
export * from './types/insert-dtos';

// Export Connection Pool & Migration Runner
export * from './connection/DatabasePool';
export * from './connection/MigrationRunner';

// Export Repository Interfaces
export * from './repositories/interfaces/ISymbolRepository';
export * from './repositories/interfaces/ITickRepository';
export * from './repositories/interfaces/ICandleRepository';
export * from './repositories/interfaces/ITradeRepository';
export * from './repositories/interfaces/IOrderRepository';
export * from './repositories/interfaces/IExecutionRepository';
export * from './repositories/interfaces/ISignalRepository';
export * from './repositories/interfaces/IStrategyRunRepository';
export * from './repositories/interfaces/IPortfolioRepository';
export * from './repositories/interfaces/IPositionRepository';
export * from './repositories/interfaces/ILearningRecordRepository';
export * from './repositories/interfaces/IRiskLimitRepository';

// Export PG Repository Implementations
export * from './repositories/pg/PgSymbolRepository';
export * from './repositories/pg/PgTickRepository';
export * from './repositories/pg/PgCandleRepository';
export * from './repositories/pg/PgTradeRepository';
export * from './repositories/pg/PgOrderRepository';
export * from './repositories/pg/PgExecutionRepository';
export * from './repositories/pg/PgSignalRepository';
export * from './repositories/pg/PgStrategyRunRepository';
export * from './repositories/pg/PgPortfolioRepository';
export * from './repositories/pg/PgPositionRepository';
export * from './repositories/pg/PgLearningRecordRepository';
export * from './repositories/pg/PgRiskLimitRepository';
