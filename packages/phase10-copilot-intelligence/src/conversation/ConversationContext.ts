/**
 * packages/phase10-copilot-intelligence/src/conversation/ConversationContext.ts
 * Artha AI — Phase 10 Conversation Context
 *
 * Maintains session memory and routes user questions to the right data query.
 * No LLM API needed — all answers are template-driven with real data injection.
 */

import { ConversationMessage, QueryIntent } from '../types';
import { QueryHandler, IQueryDataSource } from './QueryHandler';
import { WatchlistManager } from '../watchlist/WatchlistManager';

export class ConversationContext {
  private readonly history: ConversationMessage[] = [];
  private readonly handler: QueryHandler;

  constructor(
    dataSource:  IQueryDataSource,
    watchlist:   WatchlistManager
  ) {
    this.handler = new QueryHandler(dataSource, watchlist);
  }

  /**
   * Submit a user message and get a copilot response.
   */
  async ask(userText: string): Promise<string> {
    this._addMessage('user', userText);

    const response = await this.handler.handle(userText);

    this._addMessage('copilot', response);
    return response;
  }

  /** Return last N conversation messages. */
  getHistory(last = 10): ConversationMessage[] {
    return this.history.slice(-last);
  }

  /** Format history as a readable chat transcript. */
  formatHistory(last = 10): string {
    return this.getHistory(last)
      .map(m => `[${m.role === 'user' ? '👤 You' : '🤖 Artha'}] ${m.text}`)
      .join('\n\n');
  }

  private _addMessage(role: 'user' | 'copilot', text: string): void {
    this.history.push({ role, text, timestamp: new Date() });
  }
}
