/**
 * packages/phase9-testing/src/adapters/BrokerPositionAdapter.ts
 * Artha AI — Phase 9 Angel One Position Adapter
 *
 * Mapped to v2 Angel One `/order/getposition` API schema (A17/B1):
 *   - producttype, tradingsymbol, netqty, avgnetprice, ltp, unrealised, day_buy_qty, day_sell_qty
 *   - NaN guards for all numeric fields
 *   - MIS filtering and total value summation.
 */

import { BrokerPositionRecord, IAlertNotifier } from '../types';

export class BrokerPositionAdapter {
  constructor(
    private readonly alertNotifier: IAlertNotifier
  ) {}

  /**
   * Parse raw response body from Angel One position query.
   * Filters by MIS producttype, computes total position value,
   * and enforces NaN checks.
   */
  parsePositions(rawPayload: any): { positions: BrokerPositionRecord[]; totalMISValue: number } {
    const rawData = rawPayload?.data;
    if (!Array.isArray(rawData)) {
      return { positions: [], totalMISValue: 0 };
    }

    const positions: BrokerPositionRecord[] = [];
    let totalMISValue = 0;

    for (const record of rawData) {
      try {
        const symbol = record.tradingsymbol;
        const producttype = record.producttype; // A17: producttype (not product)

        // Parse fields
        const netqty      = parseInt(record.netqty, 10);      // A17: netqty (not qty)
        const avgnetprice = parseFloat(record.avgnetprice);   // A17: avgnetprice (not avgPrice)
        const ltp         = parseFloat(record.ltp);
        const unrealised  = parseFloat(record.unrealised);
        const day_buy_qty  = parseInt(record.day_buy_qty, 10);
        const day_sell_qty = parseInt(record.day_sell_qty, 10);

        // NaN guard check
        if (
          isNaN(netqty) ||
          isNaN(avgnetprice) ||
          isNaN(ltp) ||
          isNaN(unrealised) ||
          isNaN(day_buy_qty) ||
          isNaN(day_sell_qty)
        ) {
          this.alertNotifier.sendAlert(`NaN parse guard tripped for symbol ${symbol || 'unknown'}. Skipping position record.`, {
            record
          });
          continue;
        }

        const parsed: BrokerPositionRecord = {
          producttype,
          tradingsymbol: symbol,
          netqty,
          avgnetprice,
          ltp,
          unrealised,
          day_buy_qty,
          day_sell_qty,
        };
        positions.push(parsed);

        // Accumulate MIS value
        if (producttype === 'MIS') {
          const positionValue = Math.abs(netqty) * ltp;
          totalMISValue += positionValue;
        }
      } catch (err: any) {
        this.alertNotifier.sendAlert(`Error parsing position record: ${err.message}`, { record });
      }
    }

    return { positions, totalMISValue };
  }
}
