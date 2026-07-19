/**
 * src/marketData/connection/IConnectionMonitor.ts
 * Phase 2C — Re-export + state types for IConnectionMonitor.
 *
 * The interface definition was in ConnectionMonitor.ts in Phase 2B.
 * Extracted here so ConnectionMonitor.ts (implementation) can import the type
 * without a circular reference.
 */

export type ConnectionMonitorState =
  | 'idle'        // not started, or cleanly stopped
  | 'monitoring'  // heartbeat timer running, connection healthy
  | 'degraded'    // 1–2 missed pings, still trying
  | 'dead';       // HEARTBEAT_MISS_THRESHOLD reached, DISCONNECTED emitted

export interface ConnectionMonitorStatus {
  readonly state:             ConnectionMonitorState;
  readonly missedPings:       number;
  readonly lastPongAt:        number | null;
  readonly lastPingAt:        number | null;
  readonly consecutiveMisses: number;
}

export interface IConnectionMonitor {
  startHeartbeat(sendPing: () => void): void;
  stopHeartbeat(): void;
  recordPong(): void;
  status(): ConnectionMonitorStatus;
}
