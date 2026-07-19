/**
 * packages/phase7-broker/src/adapters/LiveBrokerAdapterMock.ts
 * Artha AI — Phase 7 Live Trading Adapter (Mock)
 *
 * Exists only to prove that the vendor-agnostic IBrokerAdapter
 * interface is implementable against real broker environments.
 */

import { IBrokerAdapter, OrderReference, BrokerSubscription, BrokerStreamError, BrokerLatencyConfig, DEFAULT_LATENCY_CONFIG } from '../contracts/IBrokerAdapter';
import { OrderRequest, BrokerResponse, FillEvent } from '../types/domain';

export class LiveBrokerAdapterMock implements IBrokerAdapter {
  readonly adapter_mode = 'LIVE';

  constructor(private readonly config: BrokerLatencyConfig = DEFAULT_LATENCY_CONFIG) {}

  async placeOrder(request: OrderRequest): Promise<BrokerResponse> {
    throw new Error('mock only — no live vendor integration exists in this layer');
  }

  async cancelOrder(ref: OrderReference): Promise<BrokerResponse> {
    throw new Error('mock only — no live vendor integration exists in this layer');
  }

  async getOrderStatus(ref: OrderReference): Promise<BrokerResponse> {
    throw new Error('mock only — no live vendor integration exists in this layer');
  }

  streamFills(
    onFill: (fill: FillEvent) => void,
    onError: (err: BrokerStreamError) => void
  ): BrokerSubscription {
    throw new Error('mock only — no live vendor integration exists in this layer');
  }
}
