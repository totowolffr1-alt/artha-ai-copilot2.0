/**
 * packages/phase9-testing/src/adapters/BrokerOrderVerifier.ts
 * Artha AI — Phase 9 Angel One Order Verifier
 *
 * Verifies order status at broker (GET /order/details) for lifecycle checks.
 */

import { BrokerOrderDetail, OrderVerificationStatus } from '../types';

export class BrokerOrderVerifier {
  mapStatus(rawStatus: string): OrderVerificationStatus {
    const status = (rawStatus || '').toLowerCase();
    switch (status) {
      case 'complete':
        return 'CONFIRMED_FILLED';
      case 'cancelled':
      case 'rejected':
        return 'CONFIRMED_CANCELLED';
      case 'open':
      case 'pending':
        return 'CONFIRMED_PENDING';
      default:
        return 'NOT_FOUND';
    }
  }

  parseOrderDetail(rawResponse: any): BrokerOrderDetail | null {
    const data = rawResponse?.data;
    if (!data || !data.orderid) {
      return null;
    }

    const filledshares = parseInt(data.filledshares, 10);
    const averageprice = parseFloat(data.averageprice);

    return {
      orderid: data.orderid,
      status: this.mapStatus(data.status),
      filledshares: isNaN(filledshares) ? 0 : filledshares,
      averageprice: isNaN(averageprice) ? 0 : averageprice,
    };
  }
}
