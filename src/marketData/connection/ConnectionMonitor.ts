/**
 * src/marketData/connection/ConnectionMonitor.ts
 * Phase 2C — IConnectionMonitor implementation.
 *
 * Tracks liveness via heartbeat ping/pong at HEARTBEAT_INTERVAL_MS (10s).
 * After HEARTBEAT_MISS_THRESHOLD (3) consecutive missed pongs, emits
 * DISCONNECTED on the EventBus so the reconnect loop begins.
 *
 * SmartAPI heartbeat protocol:
 *   - Client sends the string "ping" every 10 seconds
 *   - Server responds with "pong"
 *   - If 3 consecutive pings go unanswered → connection is dead
 *
 * The monitor owns the timer but NOT the WebSocket — it receives a sendPing fn
 * and calls it. This keeps the monitor decoupled from ws-specific APIs and
 * makes it fully testable with jest fake timers.
 */

import type { IEventBus }                               from '../EventBus';
import type {
  IConnectionMonitor,
  ConnectionMonitorState,
  ConnectionMonitorStatus,
}                                                       from './IConnectionMonitor';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MISS_THRESHOLD,
}                                                       from './IConnectionStrategy';

// ─── ConnectionMonitor ────────────────────────────────────────────────────────

export class ConnectionMonitor implements IConnectionMonitor {
  private state:            ConnectionMonitorState = 'idle';
  private timer:            ReturnType<typeof setInterval> | null = null;
  private consecutiveMisses = 0;
  private totalMisses       = 0;
  private lastPingAt:       number | null = null;
  private lastPongAt:       number | null = null;
  private sendPingFn:       (() => void) | null = null;
  private readonly adapterName: string;

  constructor(
    private readonly bus:    IEventBus,
    adapterName:             string,
  ) {
    this.adapterName = adapterName;
  }

  // ─── IConnectionMonitor ────────────────────────────────────────────────────

  startHeartbeat(sendPing: () => void): void {
    if (this.timer !== null) {
      // Already monitoring — idempotent
      return;
    }

    this.sendPingFn       = sendPing;
    this.state            = 'monitoring';
    this.consecutiveMisses = 0;

    this.timer = setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.sendPingFn        = null;
    this.consecutiveMisses = 0;
    this.state             = 'idle';
  }

  recordPong(): void {
    this.lastPongAt        = Date.now();
    this.consecutiveMisses = 0;

    if (this.state === 'degraded') {
      // Connection recovered
      this.state = 'monitoring';
    }
  }

  status(): ConnectionMonitorStatus {
    return {
      state:            this.state,
      missedPings:      this.totalMisses,
      lastPongAt:       this.lastPongAt,
      lastPingAt:       this.lastPingAt,
      consecutiveMisses: this.consecutiveMisses,
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private tick(): void {
    const now = Date.now();

    // Check if previous ping was answered
    if (this.lastPingAt !== null) {
      const pongReceivedAfterLastPing =
        this.lastPongAt !== null && this.lastPongAt > this.lastPingAt;

      if (!pongReceivedAfterLastPing) {
        this.consecutiveMisses++;
        this.totalMisses++;

        if (this.consecutiveMisses >= HEARTBEAT_MISS_THRESHOLD) {
          this.declareDead();
          return;
        }

        this.state = 'degraded';
      } else {
        // Pong received — reset miss counter
        this.consecutiveMisses = 0;
        this.state = 'monitoring';
      }
    }

    // Send next ping
    this.lastPingAt = now;
    try {
      this.sendPingFn?.();
    } catch {
      // WebSocket.send() can throw if socket is already closing.
      // The next tick will detect the miss and declare dead if needed.
    }
  }

  private declareDead(): void {
    this.state = 'dead';

    // Stop the timer before emitting — prevents further ticks during reconnect
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.sendPingFn = null;

    this.bus.emit({
      type:        'DISCONNECTED',
      adapterName: this.adapterName,
      reason:      `Heartbeat timeout: ${HEARTBEAT_MISS_THRESHOLD} consecutive pings unanswered`,
      timestamp:   Date.now(),
    });
  }
}
