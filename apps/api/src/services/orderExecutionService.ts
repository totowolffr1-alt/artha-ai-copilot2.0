/**
 * orderExecutionService.ts — Phase 19: Autonomous Trading Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Translates approved SignalEvents into real Angel One NSE orders.
 * In PAPER mode, simulates orders without calling the broker API.
 *
 * ORDER FLOW:
 *  Signal → RiskGuardian.canExecute() → [Human Approval Gate?]
 *  → CapitalVault.reserveCapital() → AngelOne.placeOrder()
 *  → TradeJournalService.recordEntry() → tick-by-tick TP/SL monitor
 *  → AngelOne.placeOrder(EXIT) → TradeJournalService.recordExit()
 *  → CapitalVault.releaseCapital(netPnL) → RiskGuardian.onPositionClosed()
 */

import { capitalVault } from '../../../../packages/phase5-strategy/src/vault/CapitalVault';
import { RiskGuardian } from '../../../../packages/phase5-strategy/src/vault/RiskGuardian';
import { SignalEvent } from '../../../../packages/phase5-strategy/src/signals/SignalEvent';
import { getApiHeaders, getSessionStatus } from './brokerSession';
import { TradeJournalService } from './tradeJournalService';
import { pushNotification } from './notificationService';

const ANGEL_ONE_API_BASE = 'https://apiconnect.angelone.in';

// ── Singletons ─────────────────────────────────────────────────────────────────
export const riskGuardian = new RiskGuardian(capitalVault, {
  maxConcurrentPositions: 3,
  minConfidence: 60,
  humanApprovalThresholdINR: 5_000,
  humanApprovalTimeoutMs: 60_000,
  consecutiveLossLimit: 3,
  consecutiveLossCooldownMs: 2 * 60 * 60 * 1000,
});

// ── Pending human approval queue ──────────────────────────────────────────────
interface PendingApproval {
  signal: SignalEvent;
  tradeValue: number;
  qty: number;
  expiresAt: number;
  resolve: (approved: boolean) => void;
}
const pendingApprovals = new Map<string, PendingApproval>();

// ── Order Types ───────────────────────────────────────────────────────────────
type OrderVariety = 'NORMAL' | 'STOPLOSS' | 'AMO';
type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
type TransactionType = 'BUY' | 'SELL';
type ProductType = 'INTRADAY' | 'DELIVERY' | 'CARRYFORWARD';

interface AngelOrderPayload {
  variety: OrderVariety;
  tradingsymbol: string;
  symboltoken: string;
  transactiontype: TransactionType;
  exchange: 'NSE' | 'BSE';
  ordertype: OrderType;
  producttype: ProductType;
  duration: 'DAY' | 'IOC';
  price: number;
  triggerprice?: number;
  quantity: number;
}

interface OrderResult {
  success: boolean;
  orderId?: string;
  message: string;
  isPaper: boolean;
}

// ── Symbol → Token mapping (subset, extend as needed) ─────────────────────────
const SYMBOL_TOKENS: Record<string, string> = {
  RELIANCE: '2885', TCS: '11536', INFY: '1594', HDFCBANK: '1333',
  ICICIBANK: '4963', WIPRO: '3787', SBIN: '3045', TATAMOTORS: '3432',
  BAJFINANCE: '317', CUPID: '13984', ZOMATO: '5097', KPITTECH: '6858',
  HAL: '2303', IRCTC: '8349', GOLDBEES: '1014438', NIFTYBEES: '1148',
  SILVRBEES: '2845', SILVERBEES: '2845', PAYTM: '10604',
};

function getToken(symbol: string): string {
  return SYMBOL_TOKENS[symbol.toUpperCase()] ?? '0';
}

// ── Core Order Placement ──────────────────────────────────────────────────────

async function placeAngelOrder(payload: AngelOrderPayload): Promise<OrderResult> {
  if (capitalVault.isPaperMode()) {
    // Simulate order in paper mode
    const fakeOrderId = `PAPER-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    console.log(`[OrderExecution] 📄 PAPER ORDER — ${payload.transactiontype} ${payload.quantity}x ${payload.tradingsymbol} @ ₹${payload.price} | ID: ${fakeOrderId}`);
    return { success: true, orderId: fakeOrderId, message: 'Paper order simulated', isPaper: true };
  }

  // Live order via Angel One API
  try {
    const headers = await getApiHeaders();
    const response = await fetch(`${ANGEL_ONE_API_BASE}/rest/secure/angelbroking/order/v1/placeOrder`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data: any = await response.json();
    if (data.status && data.data?.orderid) {
      console.log(`[OrderExecution] ✅ LIVE ORDER placed — ${payload.transactiontype} ${payload.tradingsymbol} | OrderID: ${data.data.orderid}`);
      return { success: true, orderId: data.data.orderid, message: 'Order placed', isPaper: false };
    }
    throw new Error(data.message || 'Order placement failed');
  } catch (err: any) {
    console.error(`[OrderExecution] ❌ Order failed:`, err.message);
    return { success: false, message: err.message, isPaper: false };
  }
}

// ── Main Execution Entry Point ─────────────────────────────────────────────────

/**
 * Execute a signal as a trade. Runs full risk check → capital reservation
 * → [optional human approval] → order placement → journal entry.
 */
export async function executeSignal(signal: SignalEvent): Promise<{
  executed: boolean;
  isPaper: boolean;
  orderId?: string;
  reason: string;
}> {
  const qty = signal.recommended_qty ?? 1;
  const tradeValue = signal.entry_price * qty;
  const vaultMode = capitalVault.getMode();

  // ── Step 1: Risk Guardian check ───────────────────────────────────────────
  const decision = riskGuardian.canExecute(signal, tradeValue);

  if (decision.verdict === 'REJECT') {
    console.warn(`[OrderExecution] ⛔ REJECTED: ${decision.reason}`);
    await pushNotification({
      component: 'OrderExecution',
      severity: 'WARNING',
      title: `Signal Rejected: ${signal.symbol}`,
      message: decision.reason,
    });
    return { executed: false, isPaper: false, reason: decision.reason };
  }

  if (decision.verdict === 'PAPER_ONLY') {
    console.log(`[OrderExecution] 📄 Paper-only: ${decision.reason}`);
    // Proceed as paper trade
  }

  // Adjust qty if scaled down
  const finalQty = decision.verdict === 'SCALE_DOWN' && decision.adjustedQty
    ? decision.adjustedQty
    : qty;
  const finalTradeValue = signal.entry_price * finalQty;

  // ── Step 2: Human approval gate ──────────────────────────────────────────
  if (decision.verdict === 'AWAITING_APPROVAL') {
    const approved = await waitForHumanApproval(signal, finalTradeValue, finalQty, decision.approvalTimeoutMs ?? 60_000);
    if (!approved) {
      return { executed: false, isPaper: false, reason: 'Human approval timeout — trade cancelled.' };
    }
  }

  // ── Step 3: Reserve capital ───────────────────────────────────────────────
  const tradeId = `trd-${Math.random().toString(36).substring(2, 11)}`;
  const reserved = capitalVault.reserveCapital(tradeId, signal.symbol, finalTradeValue);
  if (!reserved) {
    return { executed: false, isPaper: false, reason: 'Capital reservation failed — vault may be in restricted state.' };
  }

  // ── Step 4: Place order ───────────────────────────────────────────────────
  const direction: TransactionType = signal.direction === 'LONG' ? 'BUY' : 'SELL';
  const orderPayload: AngelOrderPayload = {
    variety: 'NORMAL',
    tradingsymbol: signal.symbol,
    symboltoken: getToken(signal.symbol),
    transactiontype: direction,
    exchange: signal.exchange as 'NSE' | 'BSE',
    ordertype: 'MARKET',
    producttype: 'INTRADAY',
    duration: 'DAY',
    price: 0,           // 0 = market price for MARKET orders
    quantity: finalQty,
  };

  const result = await placeAngelOrder(orderPayload);

  if (!result.success) {
    // Release capital back if order fails
    capitalVault.releaseCapital(tradeId, 0);
    return { executed: false, isPaper: result.isPaper, reason: result.message };
  }

  // ── Step 5: Record in Trade Journal ──────────────────────────────────────
  riskGuardian.onPositionOpened();

  // Log trade entry to the SQLite database
  TradeJournalService.recordEntry({
    trade_id: tradeId,
    symbol: signal.symbol,
    segment: 'INTRADAY',
    direction: signal.direction === 'LONG' ? 'LONG' : 'SHORT',
    entry_price: signal.entry_price,
    quantity: finalQty,
    stop_loss: signal.stop_loss,
    take_profit: signal.take_profit,
    regime: signal.regime,
    regime_confidence: Math.round(signal.confidence * 100),
  });

  await pushNotification({
    component: 'OrderExecution',
    severity: 'INFO',
    title: `${result.isPaper ? '📄 Paper' : '🔴 LIVE'} Trade Opened: ${signal.direction} ${signal.symbol}`,
    message: `${finalQty} shares @ ₹${signal.entry_price} | TP: ₹${signal.take_profit} | SL: ₹${signal.stop_loss} | ${vaultMode} mode`,
  });

  return {
    executed: true,
    isPaper: result.isPaper,
    orderId: result.orderId || tradeId,
    reason: `${result.isPaper ? 'Paper' : 'Live'} order placed: ${direction} ${finalQty}x ${signal.symbol} @ ₹${signal.entry_price}`,
  };
}

/**
 * Called when a trade exits (TP/SL hit). Updates vault and risk guardian.
 */
export async function onTradeExit(tradeId: string, symbol: string, netPnL: number, exitReason: 'TP' | 'SL' | 'MANUAL'): Promise<void> {
  capitalVault.releaseCapital(tradeId, netPnL);
  riskGuardian.onPositionClosed(netPnL);

  const emoji = netPnL >= 0 ? '✅' : '❌';
  await pushNotification({
    component: 'OrderExecution',
    severity: netPnL >= 0 ? 'INFO' : 'WARNING',
    title: `${emoji} Trade Closed: ${symbol} (${exitReason})`,
    message: `Net P&L: ${netPnL >= 0 ? '+' : ''}₹${netPnL.toFixed(2)} | Vault: ₹${capitalVault.getAvailableCapital().toFixed(0)} available`,
  });

  console.log(`[OrderExecution] Trade ${tradeId} closed via ${exitReason}. P&L: ₹${netPnL.toFixed(2)}`);
}

// ── Human Approval Gate ───────────────────────────────────────────────────────

async function waitForHumanApproval(signal: SignalEvent, tradeValue: number, qty: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const approvalId = signal.signal_id;
    const expiresAt = Date.now() + timeoutMs;
    pendingApprovals.set(approvalId, { signal, tradeValue, qty, expiresAt, resolve });

    pushNotification({
      component: 'OrderExecution',
      severity: 'HIGH',
      title: `⏳ Approval Required: ${signal.direction} ${signal.symbol}`,
      message: `Trade value ₹${tradeValue.toFixed(0)} needs your approval. ${timeoutMs / 1000}s window. Go to Dashboard → Pending Orders to approve/reject.`,
    });

    // Auto-reject on timeout
    setTimeout(() => {
      if (pendingApprovals.has(approvalId)) {
        pendingApprovals.delete(approvalId);
        resolve(false);
        console.log(`[OrderExecution] Approval timeout for ${signal.symbol} — trade cancelled.`);
      }
    }, timeoutMs);
  });
}

/**
 * Called by dashboard when user approves or rejects a pending trade.
 */
export function resolveApproval(signalId: string, approved: boolean): boolean {
  const pending = pendingApprovals.get(signalId);
  if (!pending) return false;
  pendingApprovals.delete(signalId);
  pending.resolve(approved);
  return true;
}

/**
 * Get all trades currently awaiting human approval.
 */
export function getPendingApprovals() {
  return Array.from(pendingApprovals.values()).map(p => ({
    signalId: p.signal.signal_id,
    symbol: p.signal.symbol,
    direction: p.signal.direction,
    qty: p.qty,
    tradeValue: p.tradeValue,
    entryPrice: p.signal.entry_price,
    confidence: p.signal.confidence,
    regime: p.signal.regime,
    expiresAt: p.expiresAt,
    remainingMs: Math.max(0, p.expiresAt - Date.now()),
  }));
}

/**
 * Emergency kill switch — release all reservations and lock vault.
 */
export function emergencyKillSwitch(): void {
  capitalVault.lock();
  console.error('[OrderExecution] 🔒 KILL SWITCH ACTIVATED — all trading halted.');
  pushNotification({
    component: 'KillSwitch',
    severity: 'CRITICAL',
    title: '🔒 Kill Switch Activated',
    message: 'All trading halted by owner. Capital vault locked. Go to Dashboard to unlock.',
  });
}
