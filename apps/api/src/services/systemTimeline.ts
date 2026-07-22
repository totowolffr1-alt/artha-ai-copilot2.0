import { systemTimeline } from '../db/sqlite';

export interface TimelineEvent {
  id?: number;
  component: string;
  event: string;
  severity: string;
  details?: string;
  recorded_at?: string;
}

export function addEvent(component: string, event: string, severity: string, details?: string) {
  systemTimeline.insert(component, event, severity, details);
}

export function getTimeline(limit: number = 50) {
  return systemTimeline.getRecent(limit);
}
