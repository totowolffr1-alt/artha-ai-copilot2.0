/**
 * src/marketData/SimpleEventBus.ts
 *
 * Concrete IEventBus implementation. The original codebase only shipped the
 * IEventBus *interface* (EventBus.ts) — no concrete class. This is a minimal,
 * synchronous, in-memory pub/sub implementation satisfying that contract.
 */

import type { IEventBus, MarketDataEvent, MarketDataEventType } from './EventBus';

type Handler = (event: MarketDataEvent) => void;

export class SimpleEventBus implements IEventBus {
  private handlers = new Map<MarketDataEventType, Set<Handler>>();

  emit<T extends MarketDataEvent>(event: T): void {
    const set = this.handlers.get(event.type);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch (e) {
        // Handler exceptions never propagate to the emitter
        // eslint-disable-next-line no-console
        console.error(`[EventBus] handler error for ${event.type}:`, e);
      }
    }
  }

  on<T extends MarketDataEventType>(
    eventType: T,
    handler: (event: Extract<MarketDataEvent, { type: T }>) => void,
  ): () => void {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler as Handler);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      set!.delete(handler as Handler);
    };
  }

  off<T extends MarketDataEventType>(
    eventType: T,
    handler: (event: Extract<MarketDataEvent, { type: T }>) => void,
  ): void {
    this.handlers.get(eventType)?.delete(handler as Handler);
  }

  clear(): void {
    this.handlers.clear();
  }

  listenerCount(eventType: MarketDataEventType): number {
    return this.handlers.get(eventType)?.size ?? 0;
  }
}
