/**
 * packages/phase9-testing/src/types.ts
 * Artha AI — Phase 9 Types
 */

import { FillEvent, OrderRequest } from '../../phase7-broker/src/types/domain';

export type KillSwitchState = 'ACTIVE' | 'EMERGENCY_STOP';

export interface BrokerPositionRecord {
  producttype: string;        // 'MIS' filter
  tradingsymbol: string;
  netqty: number;             // net position quantity (negative for short)
  avgnetprice: number;
  ltp: number;
  unrealised: number;
  day_buy_qty: number;
  day_sell_qty: number;
}

export type OrderVerificationStatus =
  | 'CONFIRMED_FILLED'
  | 'CONFIRMED_CANCELLED'
  | 'CONFIRMED_PENDING'
  | 'NOT_FOUND';

export interface BrokerOrderDetail {
  status: OrderVerificationStatus;
  filledshares: number;
  averageprice: number;
  orderid: string;
}

export type DataAgeTier = 'Tier 1' | 'Tier 2' | 'Tier 3';

export interface UnexpectedFillRecord {
  order_id: string;
  fill_event: FillEvent;
  escalated_at: Date;
  resolved_at?: Date;
  resolution?: 'APPLIED' | 'REJECTED' | 'AUTO_ESCALATED';
}

export interface SessionConfig {
  session_id: string;
  rotating: boolean;
  rotation_in_progress: boolean;
  last_rotated_at?: Date;
}
export interface IAlertNotifier {
  sendAlert(message: string, context?: Record<string, any>): Promise<void>;
}

// Simple console mock alert notifier for personal accounts
export class ConsoleNotifier implements IAlertNotifier {
  async sendAlert(message: string, context?: Record<string, any>): Promise<void> {
    console.warn(`[SAFETY ALERT] ${message}`, context ? JSON.stringify(context) : '');
  }
}
