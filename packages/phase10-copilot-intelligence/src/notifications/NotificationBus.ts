/**
 * packages/phase10-copilot-intelligence/src/notifications/NotificationBus.ts
 * Artha AI — Phase 10 Notification Bus
 *
 * Dispatches alerts to all registered channels simultaneously.
 */

import { CopilotAlert, INotificationChannel } from '../types';

export class NotificationBus {
  private readonly channels: INotificationChannel[] = [];

  register(channel: INotificationChannel): void {
    this.channels.push(channel);
  }

  async send(alert: CopilotAlert): Promise<void> {
    await Promise.allSettled(
      this.channels.map(ch => ch.send(alert))
    );
  }
}
