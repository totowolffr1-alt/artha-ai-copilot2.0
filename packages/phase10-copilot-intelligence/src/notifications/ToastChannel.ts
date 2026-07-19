/**
 * packages/phase10-copilot-intelligence/src/notifications/ToastChannel.ts
 * Artha AI — Phase 10 Desktop Toast Notification Channel
 *
 * Fires Windows/macOS/Linux desktop toast notifications via node-notifier.
 * Gracefully degrades if node-notifier is unavailable.
 */

import { CopilotAlert, INotificationChannel } from '../types';

export class ToastChannel implements INotificationChannel {
  async send(alert: CopilotAlert): Promise<void> {
    try {
      // Dynamic import — gracefully skips if node-notifier is not installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const notifier = require('node-notifier');
      notifier.notify({
        title:   alert.title,
        message: alert.body.split('\n').slice(0, 3).join(' | '), // first 3 lines
        sound:   alert.urgency === 'CRITICAL' || alert.urgency === 'HIGH',
        wait:    false,
      });
    } catch {
      // node-notifier not available — skip silently
    }
  }
}
