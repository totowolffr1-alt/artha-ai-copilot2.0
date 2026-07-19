/**
 * packages/phase10-copilot-intelligence/src/index.ts
 * Artha AI — Phase 10 Public Exports
 */

// Engine
export { CopilotEngine }     from './engine/CopilotEngine';
export type { CopilotEngineConfig } from './engine/CopilotEngine';
export { OpportunityScorer } from './engine/OpportunityScorer';
export { LearningScheduler } from './engine/LearningScheduler';

// Composer
export { BriefComposer }     from './composer/BriefComposer';
export type { DailyBriefData, WeeklyDigestData } from './composer/BriefComposer';

// Notifications
export { NotificationBus }   from './notifications/NotificationBus';
export { ConsoleChannel }    from './notifications/ConsoleChannel';
export { ToastChannel }      from './notifications/ToastChannel';

// Conversation
export { ConversationContext } from './conversation/ConversationContext';
export { QueryHandler }        from './conversation/QueryHandler';
export type { IQueryDataSource } from './conversation/QueryHandler';

// Watchlist & Guards
export { WatchlistManager }     from './watchlist/WatchlistManager';
export { MarketHoursGuard }     from './guards/MarketHoursGuard';
export { AlertCooldownGuard }   from './guards/AlertCooldownGuard';
export { NewsEventGuard }       from './guards/NewsEventGuard';
export type { CorporateEvent, CorporateEventType } from './guards/NewsEventGuard';
export { SmallCapUniverseLoader } from './universe/SmallCapUniverseLoader';
export type { SmallCapIndex, CircuitCategory, UniverseEntry } from './universe/SmallCapUniverseLoader';

// Types
export * from './types';