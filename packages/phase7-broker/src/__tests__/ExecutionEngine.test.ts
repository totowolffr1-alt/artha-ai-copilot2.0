/**
 * packages/phase7-broker/src/__tests__/ExecutionEngine.test.ts
 * Artha AI — Phase 7 Broker & Execution Layer Unit Tests
 */

import { ExecutionStateMachine } from '../state/ExecutionStateMachine';
import { TransactionCostFilter } from '../protection/TransactionCostFilter';
import { SmartTrailingStop } from '../protection/SmartTrailingStop';
import { PaperBrokerAdapter } from '../adapters/PaperBrokerAdapter';
import { ExecutionOrchestrator } from '../orchestrator/ExecutionOrchestrator';
import { SignalEvent, TradeApprovalResult } from '../../../phase6-tradingview/src/types';

describe('ExecutionStateMachine', () => {
  it('validates basic lifecycle transition flow', () => {
    const sm = new ExecutionStateMachine();
    expect(sm.getState()).toBe('CREATED');

    sm.transitionTo('SENT_TO_BROKER');
    expect(sm.getState()).toBe('SENT_TO_BROKER');

    sm.transitionTo('FILLED');
    expect(sm.getState()).toBe('FILLED');
  });

  it('throws on invalid transitions', () => {
    const sm = new ExecutionStateMachine();
    expect(() => sm.transitionTo('FILLED')).toThrow('Invalid transition from CREATED to FILLED');
  });

  it('allows retry transition from REJECTED back to SENT_TO_BROKER', () => {
    const sm = new ExecutionStateMachine();
    sm.transitionTo('SENT_TO_BROKER');
    sm.transitionTo('REJECTED');
    expect(sm.getState()).toBe('REJECTED');

    sm.transitionTo('SENT_TO_BROKER');
    expect(sm.getState()).toBe('SENT_TO_BROKER');
  });
});

describe('TransactionCostFilter', () => {
  const filter = new TransactionCostFilter();

  it('passes liquid low-fee setup', () => {
    const result = filter.check({
      qty: 100,
      entry_price: 1000,
      take_profit: 1050,
      bid: 999.8,
      ask: 1000.2,
      is_intraday: false,
      max_friction_pct_of_profit: 0.10,
    });
    expect(result.passed).toBe(true);
    expect(result.cost_ratio).toBeLessThan(0.10);
  });

  it('rejects illiquid setup where slippage eats >5% profit target', () => {
    const result = filter.check({
      qty: 10,
      entry_price: 1000,
      take_profit: 1010,
      bid: 990,
      ask: 1010, // 2% spread
      is_intraday: false,
      max_friction_pct_of_profit: 0.05,
    });
    expect(result.passed).toBe(false);
    expect(result.cost_ratio).toBeGreaterThan(0.05);
  });
});

describe('SmartTrailingStop', () => {
  const tsl = new SmartTrailingStop();

  it('returns K=2.2 for STRONG_BULL and K=1.3 for NEUTRAL/CAUTION', () => {
    expect(tsl.getMultiplier('STRONG_BULL')).toBe(2.2);
    expect(tsl.getMultiplier('NEUTRAL')).toBe(1.3);
    expect(tsl.getMultiplier('HIGH_VOLATILITY')).toBe(2.8);
  });

  it('moves stop-loss UP for LONG trades as price rises', () => {
    const state = { hwm_price: 1000, current_stop_price: 980, K_multiplier: 2 };
    const updated = tsl.update({
      direction: 'LONG',
      current_price: 1020,
      atr: 10,
      market_state: 'STRONG_BULL', // K=2.2
      state,
    });

    expect(updated.hwm_price).toBe(1020);
    // target stop = 1020 - 10 × 2.2 = 998
    expect(updated.current_stop_price).toBe(998);
  });

  it('does not move stop-loss DOWN for LONG trades when price drops', () => {
    const state = { hwm_price: 1020, current_stop_price: 998, K_multiplier: 2.2 };
    const updated = tsl.update({
      direction: 'LONG',
      current_price: 1010,
      atr: 10,
      market_state: 'STRONG_BULL',
      state,
    });

    expect(updated.hwm_price).toBe(1020);
    expect(updated.current_stop_price).toBe(998); // remains unchanged
  });
});

describe('ExecutionOrchestrator & Paper Broker Integration', () => {
  const mockRejectionWriter = {
    markRejected: jest.fn(),
  };

  const signal: SignalEvent = {
    signal_id: 'sig-123',
    symbol_id: 'sym-456',
    strategy_run_id: 'run-789',
    signal_type: 'entry_long',
    direction: 'LONG',
    strength: 0.8,
    entry_price_hint: 1000,
    stop_loss: 985,
    take_profit: 1060,
    kelly_fraction: 0.1,
    regime: 'trending_up',
    features: { ticker: 'INFY', bid: 999.8, ask: 1000.2 },
    fired_at: new Date(),
  };

  const approval: TradeApprovalResult = {
    decision: 'APPROVED',
    confidence: 0.75,
    suggestedSize: 50,
    reasons: [],
    signal_id: 'sig-123',
    evaluated_at: new Date(),
    market_state: 'STRONG_BULL',
    risk_budget_multiplier: 1.0,
    stage_reached: 5,
    conviction_score: 0.8,
    max_safe_qty: 50,
    sizing_method: 'atr_kelly',
  };

  it('writes rejection back to ISignalRejectionWriter on REJECTED decision', async () => {
    const paperAdapter = new PaperBrokerAdapter();
    const orch = new ExecutionOrchestrator(paperAdapter, mockRejectionWriter);

    const rejectApproval = { ...approval, decision: 'REJECTED' as const, reasons: ['Too high risk'] };
    const res = await orch.handleVerdict(signal, rejectApproval);

    expect(res).toBeNull();
    expect(mockRejectionWriter.markRejected).toHaveBeenCalledWith('sig-123', { reasons: ['Too high risk'] });
  });

  it('executes trade, places OCO brackets and derives final result upon fill', async () => {
    const paperAdapter = new PaperBrokerAdapter();
    const orch = new ExecutionOrchestrator(paperAdapter, mockRejectionWriter);

    // Setup fill stream callback
    paperAdapter.streamFills(
      () => {},
      () => {}
    );

    const intentId = await orch.handleVerdict(signal, approval);
    expect(intentId).not.toBeNull();

    const orderId = `idemp-${intentId}`;
    const result = orch.getResult(orderId);

    expect(result).not.toBeNull();
    expect(result!.final_status).toBe('FILLED');
    expect(result!.total_filled_qty).toBe(50);
    expect(result!.avg_fill_price).toBe(1000);
  });
});
