/**
 * packages/phase7-broker/src/adapters/AngelOneOrderMapper.ts
 * Artha AI — Phase 7 Angel One Order Request Mapper
 */

import { OrderRequest } from '../types/domain';

export interface AngelOneOrderBody {
  variety: 'NORMAL' | 'STOPLOSS' | 'AMO' | 'ROBO';
  tradingsymbol: string;
  symboltoken: string;
  transactiontype: 'BUY' | 'SELL';
  exchange: 'NSE' | 'BSE' | 'NFO' | 'MCX';
  ordertype: 'MARKET' | 'LIMIT' | 'STOPLOSS_LIMIT' | 'STOPLOSS_MARKET';
  producttype: 'DELIVERY' | 'CARRYFORWARD' | 'MARGIN' | 'INTRADAY' | 'BO';
  duration: 'DAY' | 'IOC';
  price: string;
  triggerprice: string;
  quantity: string;
}

function isMarketClosedIST(): boolean {
  try {
    const now = new Date();
    const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(istString);
    const day = istDate.getDay(); // 0 = Sun, 6 = Sat
    const timeInMinutes = istDate.getHours() * 60 + istDate.getMinutes();

    if (day === 0 || day === 6) return true;
    if (timeInMinutes < 555 || timeInMinutes >= 930) return true; // Outside 9:15 AM - 3:30 PM
  } catch {}
  return false;
}

export class AngelOneOrderMapper {
  /**
   * Maps internal OrderRequest structure to Angel One API payload.
   */
  static mapToAngelOne(req: OrderRequest, symbolToken: string): AngelOneOrderBody {
    // Map order type
    let ordertype: AngelOneOrderBody['ordertype'] = 'MARKET';
    if (req.order_type === 'LIMIT') ordertype = 'LIMIT';
    if (req.order_type === 'SL') ordertype = 'STOPLOSS_LIMIT';
    if (req.order_type === 'SL-M') ordertype = 'STOPLOSS_MARKET';

    // Map product type based on active trading mode
    const mode = process.env.TRADING_MODE || 'INTRADAY';
    let producttype: AngelOneOrderBody['producttype'] = mode === 'SWING' ? 'DELIVERY' : 'INTRADAY';
    if (req.product_type === 'CNC') producttype = 'DELIVERY';
    if (req.product_type === 'NRML') producttype = 'CARRYFORWARD';

    // variety: SL order uses STOPLOSS variety, standard order uses NORMAL variety
    const variety: AngelOneOrderBody['variety'] = 
      (req.order_type === 'SL' || req.order_type === 'SL-M') ? 'STOPLOSS' : 'NORMAL';

    return {
      variety,
      tradingsymbol: req.symbol_id + '-EQ', // NSE equity suffix
      symboltoken: symbolToken,
      transactiontype: req.broker_direction === 'BUY' ? 'BUY' : 'SELL',
      exchange: 'NSE', // Default exchange
      ordertype,
      producttype,
      duration: req.validity === 'IOC' ? 'IOC' : 'DAY',
      price: req.price ? req.price.toFixed(2) : '0.00',
      triggerprice: req.trigger_price ? req.trigger_price.toFixed(2) : '0.00',
      quantity: req.qty.toString()
    };
  }
}
