/**
 * packages/phase7-broker/src/orchestrator/ExecutionOrchestrator.ts
 * Artha AI — Phase 7 Execution Orchestrator & Bracket Manager
 */

import { SignalEvent } from '../../../phase6-tradingview/src/types';
import { TradeApprovalResult } from '../../../phase6-tradingview/src/types';
import { IExecutionOrchestrator, ISignalRejectionWriter } from '../contracts/IExecutionOrchestrator';
import { IBrokerAdapter, OrderReference } from '../contracts/IBrokerAdapter';
import { TradeIntent, OrderRequest, ExecutionEvent, ExecutionResult, OrderStatus, FillEvent, BracketConfig, TrailingStopState } from '../types/domain';
import { InternalOrderEvent } from '../types/internal';
import { ExecutionStateMachine } from '../state/ExecutionStateMachine';
import { TransactionCostFilter } from '../protection/TransactionCostFilter';
import { SmartTrailingStop } from '../protection/SmartTrailingStop';

export class ExecutionOrchestrator implements IExecutionOrchestrator {
  private readonly costFilter = new TransactionCostFilter();
  private readonly smartStop  = new SmartTrailingStop();

  // In-memory data stores (hydrated from/to DB in real live environments)
  private readonly intents:    Map<string, TradeIntent> = new Map();
  private readonly attempts:   Map<string, OrderRequest[]> = new Map(); // idempotency_key -> requests
  private readonly stateMachines: Map<string, ExecutionStateMachine> = new Map(); // idempotency_key -> SM
  private readonly eventsLog:  Map<string, ExecutionEvent[]> = new Map(); // idempotency_key -> events
  private readonly activeTrails: Map<string, { state: TrailingStopState; direction: 'LONG' | 'SHORT'; symbol_id: string; last_sl_request_id?: string }> = new Map(); // symbol_id -> trail

  constructor(
    private readonly brokerAdapter: IBrokerAdapter,
    private readonly rejectionWriter: ISignalRejectionWriter,
    private readonly bracketConfig: BracketConfig = { target_multiple_atr: 2.0, stop_multiple_atr: 1.5 },
    private readonly defaultAccountId: string = 'DEFAULT_ACCOUNT',
    private readonly maxFrictionPct: number = 0.10
  ) {}

  async handleVerdict(
    signal: SignalEvent,
    verdict: TradeApprovalResult,
    accountId: string = this.defaultAccountId
  ): Promise<string | null> {
    const now = new Date();

    // ── 1. Rejection write-back ──────────────────────────────────
    if (verdict.decision === 'REJECTED') {
      this.rejectionWriter.markRejected(signal.signal_id, { reasons: verdict.reasons });
      return null;
    }

    // ── 2. Create and store TradeIntent ──────────────────────────
    const intent_id = `intent-${Math.random().toString(36).slice(2, 9)}`;
    const intent: TradeIntent = {
      intent_id,
      signal_id: signal.signal_id,
      account_id: accountId,
      symbol_id: signal.symbol_id,
      direction: signal.direction,
      entry_price_hint: signal.entry_price_hint,
      stop_loss: signal.stop_loss,
      take_profit: signal.take_profit,
      decision: verdict.decision,
      approved_qty: verdict.suggestedSize,
      confidence: verdict.confidence,
      conviction_score: verdict.conviction_score,
      risk_budget_multiplier: verdict.risk_budget_multiplier,
      market_state: verdict.market_state,
      sizing_method: verdict.sizing_method,
      evaluated_at: verdict.evaluated_at,
      received_at: now,
    };
    this.intents.set(intent_id, intent);

    // ── 3. Transaction Cost Filter check ─────────────────────────
    const features = signal.features as any;
    const bid = features?.bid ?? signal.entry_price_hint - 0.10;
    const ask = features?.ask ?? signal.entry_price_hint + 0.10;
    const costCheck = this.costFilter.check({
      qty: intent.approved_qty,
      entry_price: intent.entry_price_hint,
      take_profit: intent.take_profit,
      bid,
      ask,
      is_intraday: false,
      max_friction_pct_of_profit: this.maxFrictionPct,
    });

    const idempotencyKey = `idemp-${intent_id}`;
    const sm = new ExecutionStateMachine();
    this.stateMachines.set(idempotencyKey, sm);
    this.eventsLog.set(idempotencyKey, []);

    this.logEvent(idempotencyKey, intent, '', 'CREATED', null, null, null);

    if (!costCheck.passed) {
      // Reject pre-submission
      sm.transitionTo('REJECTED');
      this.logEvent(idempotencyKey, intent, '', 'REJECTED', null, null, null);
      return intent_id;
    }

    // ── 4. Submit OrderRequest ───────────────────────────────────
    await this.submitAttempt(intent, idempotencyKey, 1);
    return intent_id;
  }

  async onLiveQuote(symbol_id: string, ltp: number): Promise<void> {
    // Process any active smart trailing stop-losses for this symbol
    for (const [idempotencyKey, trail] of this.activeTrails.entries()) {
      if (trail.symbol_id !== symbol_id) continue;

      const intent = [...this.intents.values()].find(i => `idemp-${i.intent_id}` === idempotencyKey);
      if (!intent) continue;

      const features = intent.received_at ? { atr: 10 } : {}; // fallback
      const atr = 10; // ATR fallback

      const updated = this.smartStop.update({
        direction: trail.direction,
        current_price: ltp,
        atr,
        market_state: intent.market_state,
        state: trail.state,
      });

      if (updated.current_stop_price > trail.state.current_stop_price) {
        // Stop price moved up! We must update the stop-loss order at the broker
        // By cancelling the old SL and placing a new one.
        if (trail.last_sl_request_id) {
          await this.brokerAdapter.cancelOrder({
            idempotency_key: `${idempotencyKey}-sl`,
            broker_order_id: `broker-sl-${idempotencyKey.slice(0, 8)}`,
          });
        }

        const slRequest: OrderRequest = {
          order_request_id: `req-sl-upd-${Math.random().toString(36).slice(2, 9)}`,
          intent_id: intent.intent_id,
          idempotency_key: `${idempotencyKey}-sl`,
          symbol_id: intent.symbol_id,
          broker_direction: intent.direction === 'LONG' ? 'SELL' : 'BUY',
          order_type: 'SL',
          qty: intent.approved_qty,
          price: updated.current_stop_price,
          trigger_price: updated.current_stop_price,
          product_type: 'CNC',
          validity: 'DAY',
          created_at: new Date(),
          attempt: 1,
        };

        const response = await this.brokerAdapter.placeOrder(slRequest);
        trail.state = updated;
        trail.last_sl_request_id = slRequest.order_request_id;
      }
    }
  }

  getEvents(orderId: string): readonly ExecutionEvent[] {
    return this.eventsLog.get(orderId) ?? [];
  }

  getResult(orderId: string): ExecutionResult | null {
    const events = this.getEvents(orderId);
    if (events.length === 0) return null;

    const terminalEvent = events[events.length - 1];
    const isTerminal = ['FILLED', 'REJECTED', 'CANCELLED'].includes(terminalEvent.status);
    if (!isTerminal) return null;

    const intent = [...this.intents.values()].find(i => `idemp-${i.intent_id}` === orderId);
    if (!intent) return null;

    const fillEvents = events.filter(e => e.fill_price !== null && e.fill_quantity !== null);
    const total_filled = fillEvents.reduce((s, e) => s + (e.fill_quantity ?? 0), 0);
    const sum_pv = fillEvents.reduce((s, e) => s + (e.fill_price ?? 0) * (e.fill_quantity ?? 0), 0);
    const avg_price = total_filled > 0 ? sum_pv / total_filled : null;

    const sum_slip = fillEvents.reduce((s, e) => s + (e.slippage ?? 0) * (e.fill_quantity ?? 0), 0);
    const avg_slippage = total_filled > 0 ? sum_slip / total_filled : null;

    const attempts = this.attempts.get(orderId) ?? [];

    return {
      order_id: orderId,
      trade_intent_id: intent.intent_id,
      signal_id: intent.signal_id,
      account_id: intent.account_id,
      symbol_id: intent.symbol_id,
      direction: intent.direction,
      final_status: terminalEvent.status as any,
      requested_qty: intent.approved_qty,
      total_filled_qty: total_filled,
      fill_count: fillEvents.length,
      avg_fill_price: avg_price,
      realized_slippage_bps: avg_slippage,
      total_commission: fillEvents.length * 20.0,
      total_attempts: attempts.length,
      opened_at: events[0].occurred_at,
      closed_at: terminalEvent.occurred_at,
      total_execution_latency_ms: terminalEvent.occurred_at.getTime() - intent.received_at.getTime(),
      reject_reason: terminalEvent.status === 'REJECTED' ? 'Order rejected or cancelled' : null,
      cancel_reason: terminalEvent.status === 'CANCELLED' ? 'Order expired or cancelled' : null,
    };
  }

  // Helper: Submit a physical attempt
  private async submitAttempt(intent: TradeIntent, idempotencyKey: string, attempt: number): Promise<void> {
    const sm = this.stateMachines.get(idempotencyKey)!;
    sm.transitionTo('SENT_TO_BROKER');
    this.logEvent(idempotencyKey, intent, `req-${idempotencyKey}-${attempt}`, 'SENT_TO_BROKER', null, null, null);

    const request: OrderRequest = {
      order_request_id: `req-${idempotencyKey}-${attempt}`,
      intent_id: intent.intent_id,
      idempotency_key: idempotencyKey,
      symbol_id: intent.symbol_id,
      broker_direction: intent.direction === 'LONG' ? 'BUY' : 'SELL',
      order_type: 'MARKET',
      qty: intent.approved_qty,
      price: null,
      trigger_price: null,
      product_type: 'CNC',
      validity: 'DAY',
      created_at: new Date(),
      attempt,
    };

    if (!this.attempts.has(idempotencyKey)) {
      this.attempts.set(idempotencyKey, []);
    }
    this.attempts.get(idempotencyKey)!.push(request);

    // Place the order
    const response = await this.brokerAdapter.placeOrder(request);

    if (response.normalized_status === 'FILLED') {
      sm.transitionTo('FILLED');
      const fill: FillEvent = {
        fill_id: `fill-${idempotencyKey}-1`,
        order_request_id: request.order_request_id,
        broker_fill_id: `bfill-${idempotencyKey}-1`,
        fill_qty: request.qty,
        fill_price: intent.entry_price_hint,
        commission: 20.0,
        is_partial: false,
        slippage: {
          expected_price: intent.entry_price_hint,
          actual_price: intent.entry_price_hint,
          slippage_abs: 0,
          slippage_bps: 0,
          direction: 'NEUTRAL',
        },
        exchange_ts: new Date(),
        received_ts: new Date(),
      };

      this.logEvent(idempotencyKey, intent, request.order_request_id, 'FILLED', fill.fill_price, fill.fill_qty, 0);

      // Trigger automatic bracket OCO orders upon entry fill
      await this.submitBracketOrders(intent, idempotencyKey);
    } else if (response.normalized_status === 'REJECTED') {
      sm.transitionTo('REJECTED');
      this.logEvent(idempotencyKey, intent, request.order_request_id, 'REJECTED', null, null, null);

      // Bounded retry logic
      if (response.retryable && attempt < 3) {
        // Wait and reconcile before retry
        await new Promise(r => setTimeout(r, 50));
        const reconResponse = await this.brokerAdapter.getOrderStatus({ idempotency_key: idempotencyKey });

        if (reconResponse.normalized_status === 'REJECTED') {
          // Confirm terminal at broker, safe to retry
          await this.submitAttempt(intent, idempotencyKey, attempt + 1);
        } else {
          // Reconciled to something else, transition to that state
          sm.transitionTo(reconResponse.normalized_status as any);
          this.logEvent(idempotencyKey, intent, request.order_request_id, reconResponse.normalized_status as any, null, null, null);
        }
      }
    }
  }

  // Submit automated TP and SL bracket orders
  private async submitBracketOrders(intent: TradeIntent, idempotencyKey: string): Promise<void> {
    const atr = 10.0; // ATR fallback
    const targetPrice = intent.direction === 'LONG'
      ? intent.entry_price_hint + atr * this.bracketConfig.target_multiple_atr
      : intent.entry_price_hint - atr * this.bracketConfig.target_multiple_atr;

    const stopPrice = intent.direction === 'LONG'
      ? intent.entry_price_hint - atr * this.bracketConfig.stop_multiple_atr
      : intent.entry_price_hint + atr * this.bracketConfig.stop_multiple_atr;

    // Place Take Profit Order
    const tpRequest: OrderRequest = {
      order_request_id: `req-tp-${idempotencyKey}`,
      intent_id: intent.intent_id,
      idempotency_key: `${idempotencyKey}-tp`,
      symbol_id: intent.symbol_id,
      broker_direction: intent.direction === 'LONG' ? 'SELL' : 'BUY',
      order_type: 'LIMIT',
      qty: intent.approved_qty,
      price: targetPrice,
      trigger_price: null,
      product_type: 'CNC',
      validity: 'DAY',
      created_at: new Date(),
      attempt: 1,
    };
    await this.brokerAdapter.placeOrder(tpRequest);

    // Place Stop Loss Order
    const slRequest: OrderRequest = {
      order_request_id: `req-sl-${idempotencyKey}`,
      intent_id: intent.intent_id,
      idempotency_key: `${idempotencyKey}-sl`,
      symbol_id: intent.symbol_id,
      broker_direction: intent.direction === 'LONG' ? 'SELL' : 'BUY',
      order_type: 'SL',
      qty: intent.approved_qty,
      price: stopPrice,
      trigger_price: stopPrice,
      product_type: 'CNC',
      validity: 'DAY',
      created_at: new Date(),
      attempt: 1,
    };
    await this.brokerAdapter.placeOrder(slRequest);

    // Activate the Smart Trailing Stop state tracker
    const multiplier = this.smartStop.getMultiplier(intent.market_state);
    this.activeTrails.set(idempotencyKey, {
      state: {
        hwm_price: intent.entry_price_hint,
        current_stop_price: stopPrice,
        K_multiplier: multiplier,
      },
      direction: intent.direction,
      symbol_id: intent.symbol_id,
      last_sl_request_id: slRequest.order_request_id,
    });
  }

  private logEvent(
    idempotencyKey: string,
    intent: TradeIntent,
    request_id: string,
    status: any,
    fill_price: number | null,
    fill_qty: number | null,
    slippage: number | null
  ): void {
    const event: ExecutionEvent = {
      event_id: `evt-${Math.random().toString(36).slice(2, 9)}`,
      occurred_at: new Date(),
      signal_id: intent.signal_id,
      trade_intent_id: intent.intent_id,
      order_id: idempotencyKey,
      order_request_id: request_id,
      account_id: intent.account_id,
      symbol_id: intent.symbol_id,
      direction: intent.direction,
      status,
      fill_price,
      fill_quantity: fill_qty,
      slippage,
      execution_latency_ms: new Date().getTime() - intent.received_at.getTime(),
      broker_timestamp: new Date(),
    };
    this.eventsLog.get(idempotencyKey)!.push(event);
  }
}
