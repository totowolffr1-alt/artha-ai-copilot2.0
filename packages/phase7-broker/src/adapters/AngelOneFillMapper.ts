/**
 * packages/phase7-broker/src/adapters/AngelOneFillMapper.ts
 * Artha AI — Phase 7 Angel One Order Book to Fill Event Mapper
 */

import { FillEvent, SlippageInfo } from '../types/domain';

export class AngelOneFillMapper {
  /**
   * Maps an Angel One order log item to an internal FillEvent.
   */
  static mapToFill(
    orderRequestAttemptId: string,
    rawOrder: any,
    expectedPrice: number
  ): FillEvent {
    const fillPrice = parseFloat(rawOrder.averageprice ?? '0') || parseFloat(rawOrder.price ?? '0') || expectedPrice;
    const fillQty = parseInt(rawOrder.filledshares ?? '0', 10) || parseInt(rawOrder.quantity ?? '0', 10);

    // Slippage calculation
    const slippageAbs = fillPrice - expectedPrice;
    const slippageBps = expectedPrice > 0 ? (slippageAbs / expectedPrice) * 10000 : 0;
    
    // Determine direction
    const isBuy = rawOrder.transactiontype === 'BUY';
    let direction: SlippageInfo['direction'] = 'NEUTRAL';
    if (slippageAbs > 0) {
      direction = isBuy ? 'ADVERSE' : 'FAVORABLE';
    } else if (slippageAbs < 0) {
      direction = isBuy ? 'FAVORABLE' : 'ADVERSE';
    }

    const slippage: SlippageInfo = {
      expected_price: expectedPrice,
      actual_price: fillPrice,
      slippage_abs: slippageAbs,
      slippage_bps: Math.round(slippageBps),
      direction
    };

    return {
      fill_id: `fill-${Math.random().toString(36).substring(2, 11)}`,
      order_request_id: orderRequestAttemptId,
      broker_fill_id: rawOrder.orderid || 'unknown-broker-id',
      fill_qty: fillQty,
      fill_price: fillPrice,
      commission: 20.0, // Fixed flat brokerage fee model
      is_partial: rawOrder.status === 'partially_filled',
      slippage,
      exchange_ts: rawOrder.updatetime ? new Date(rawOrder.updatetime) : new Date(),
      received_ts: new Date()
    };
  }
}
