/**
 * packages/phase7-broker/src/types/internal.ts
 * Artha AI — Phase 7 Internal State Machine Types
 */

import { FillEvent } from './domain';

export type InternalOrderEvent =
  | OrderSubmittedEvent
  | OrderAckedEvent
  | OrderPartiallyFilledEvent
  | OrderFilledEvent
  | OrderRejectedEvent
  | OrderCancelledEvent
  | OrderExpiredEvent
  | OrderRetryScheduledEvent
  | OrderRetryExhaustedEvent
  | OrderAckAmbiguousEvent;

interface BaseInternalEvent {
  readonly event_id: string;
  readonly order_request_id: string;
  readonly occurred_at: Date;
}

export interface OrderSubmittedEvent extends BaseInternalEvent {
  readonly type: 'ORDER_SUBMITTED';
}

export interface OrderAckedEvent extends BaseInternalEvent {
  readonly type: 'ORDER_ACKED';
  readonly broker_order_id: string;
}

export interface OrderPartiallyFilledEvent extends BaseInternalEvent {
  readonly type: 'ORDER_PARTIALLY_FILLED';
  readonly fill: FillEvent;
  readonly cumulative_filled_qty: number;
  readonly remaining_qty: number;
}

export interface OrderFilledEvent extends BaseInternalEvent {
  readonly type: 'ORDER_FILLED';
  readonly fill: FillEvent;
  readonly cumulative_filled_qty: number;
}

export interface OrderRejectedEvent extends BaseInternalEvent {
  readonly type: 'ORDER_REJECTED';
  readonly reject_source: 'BROKER' | 'PRE_SUBMISSION_VALIDATION';
  readonly reject_reason: string;
  readonly retryable: boolean;
}

export interface OrderCancelledEvent extends BaseInternalEvent {
  readonly type: 'ORDER_CANCELLED';
  readonly cancelled_by: 'SYSTEM' | 'OPERATOR' | 'BROKER';
  readonly reason: string;
}

export interface OrderExpiredEvent extends BaseInternalEvent {
  readonly type: 'ORDER_EXPIRED';
  readonly unfilled_qty: number;
}

export interface OrderRetryScheduledEvent extends BaseInternalEvent {
  readonly type: 'ORDER_RETRY_SCHEDULED';
  readonly retry: RetryState;
}

export interface OrderRetryExhaustedEvent extends BaseInternalEvent {
  readonly type: 'ORDER_RETRY_EXHAUSTED';
  readonly retry: RetryState;
  readonly final_status: 'REJECTED' | 'UNKNOWN';
}

export interface OrderAckAmbiguousEvent extends BaseInternalEvent {
  readonly type: 'ORDER_ACK_AMBIGUOUS';
  readonly cause: 'NETWORK_TIMEOUT' | 'BROKER_5XX' | 'NO_RESPONSE';
  readonly action_required: 'RECONCILE_BEFORE_RETRY';
}

export interface RetryState {
  readonly attempt: number;
  readonly max_attempts: number;
  readonly backoff_ms: number;
  readonly retry_reason: 'NETWORK_TIMEOUT' | 'BROKER_5XX' | 'RATE_LIMITED' | 'ACK_AMBIGUOUS';
  readonly next_retry_at: Date | null;
  readonly last_error: string | null;
}
