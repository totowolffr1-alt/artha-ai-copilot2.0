/**
 * packages/phase9-testing/src/state/StateRestorer.ts
 * Artha AI — Phase 9 State Restorer
 *
 * Guarantees current_session configuration is valid and loaded on bootstrap.
 */

import { SessionConfig, IAlertNotifier } from '../types';

export class StateRestorer {
  private currentSession: SessionConfig | null = null;

  constructor(
    private readonly alertNotifier: IAlertNotifier
  ) {}

  async initialize(session: SessionConfig | null): Promise<void> {
    if (!session || !session.session_id) {
      await this.alertNotifier.sendAlert('BOOTSTRAP ALERT: current_session absent or corrupt on startup', {
        session
      });
      throw new Error('Bootstrap failure: current_session is missing');
    }
    this.currentSession = session;
  }

  getSession(): SessionConfig {
    if (!this.currentSession) {
      throw new Error('StateRestorer not initialized');
    }
    return this.currentSession;
  }
}
