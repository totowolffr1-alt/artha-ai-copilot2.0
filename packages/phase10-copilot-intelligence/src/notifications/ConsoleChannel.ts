/**
 * packages/phase10-copilot-intelligence/src/notifications/ConsoleChannel.ts
 * Artha AI — Phase 10 Console Notification Channel
 *
 * Rich, color-coded terminal output. Always active.
 */

import { CopilotAlert, INotificationChannel } from '../types';

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const DIM    = '\x1b[2m';

function urgencyColor(urgency: CopilotAlert['urgency']): string {
  switch (urgency) {
    case 'CRITICAL': return RED;
    case 'HIGH':     return MAGENTA;
    case 'MEDIUM':   return YELLOW;
    default:         return CYAN;
  }
}

export class ConsoleChannel implements INotificationChannel {
  async send(alert: CopilotAlert): Promise<void> {
    const color = urgencyColor(alert.urgency);
    const ts    = alert.timestamp.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });

    console.log('');
    console.log(`${color}${BOLD}${alert.title}${RESET}  ${DIM}[${ts} IST]${RESET}`);
    console.log(alert.body
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n')
    );
    console.log('');
  }
}
