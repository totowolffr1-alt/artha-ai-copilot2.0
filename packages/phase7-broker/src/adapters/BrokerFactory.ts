/**
 * packages/phase7-broker/src/adapters/BrokerFactory.ts
 * Artha AI — Universal Broker Factory
 *
 * Reads BROKER_PROVIDER from environment and auto-selects the correct adapter.
 * All adapters implement the same IBrokerAdapter interface, so the rest of the
 * system (ExecutionOrchestrator, AI Agent, Sandbox) needs ZERO changes.
 *
 * Supported brokers:
 *   ANGELONE  → SmartAPI (India, supports live streaming)
 *   UPSTOX    → Upstox API v2 (India)
 *   ZERODHA   → Kite Connect v3 (India)
 *   FYERS     → Fyers API v2 (India)
 *   DHAN      → Dhan HQ API v2 (India, zero brokerage delivery)
 *   SHOONYA   → Finvasia Shoonya API (India, zero brokerage all segments)
 *   PAPER     → PaperBrokerAdapter (always safe default)
 */

import { IBrokerAdapter } from '../contracts/IBrokerAdapter';
import { AngelOneBrokerAdapter } from './AngelOneBrokerAdapter';
import { UpstoxBrokerAdapter } from './UpstoxBrokerAdapter';
import { ZerodhaBrokerAdapter } from './ZerodhaBrokerAdapter';
import { FyersBrokerAdapter } from './FyersBrokerAdapter';
import { DhanBrokerAdapter } from './DhanBrokerAdapter';
import { ShoonyaBrokerAdapter } from './ShoonyaBrokerAdapter';
import { PaperBrokerAdapter } from './PaperBrokerAdapter';

// Supported broker identifiers
export type BrokerProvider =
  | 'ANGELONE'
  | 'UPSTOX'
  | 'ZERODHA'
  | 'FYERS'
  | 'DHAN'
  | 'SHOONYA'
  | 'PAPER';

// Human-readable metadata for each supported broker
export const BROKER_REGISTRY: Record<
  BrokerProvider,
  {
    name: string;
    website: string;
    apiDocs: string;
    brokerageModel: string;
    supportedSegments: string[];
    envVarsRequired: string[];
  }
> = {
  ANGELONE: {
    name: 'Angel One (SmartAPI)',
    website: 'https://www.angelbroking.com',
    apiDocs: 'https://smartapi.angelbroking.com/docs',
    brokerageModel: '₹20/order for F&O, free for delivery',
    supportedSegments: ['NSE', 'BSE', 'NFO', 'MCX'],
    envVarsRequired: ['ANGELONE_CLIENT_ID', 'ANGELONE_CLIENT_SECRET', 'ANGELONE_PASSWORD', 'ANGELONE_TOTP_SECRET'],
  },
  UPSTOX: {
    name: 'Upstox (API v2)',
    website: 'https://upstox.com',
    apiDocs: 'https://upstox.com/developer/api-documentation',
    brokerageModel: '₹20/order or 2.5% (F&O), zero on delivery',
    supportedSegments: ['NSE', 'BSE', 'NFO', 'CDS'],
    envVarsRequired: ['UPSTOX_ACCESS_TOKEN'],
  },
  ZERODHA: {
    name: 'Zerodha (Kite Connect v3)',
    website: 'https://zerodha.com',
    apiDocs: 'https://kite.trade/docs/connect/v3/',
    brokerageModel: '₹20/order or 0.03% (intraday/F&O), zero delivery',
    supportedSegments: ['NSE', 'BSE', 'NFO', 'CDS', 'MCX'],
    envVarsRequired: ['ZERODHA_API_KEY', 'ZERODHA_ACCESS_TOKEN'],
  },
  FYERS: {
    name: 'Fyers (API v2)',
    website: 'https://fyers.in',
    apiDocs: 'https://myapi.fyers.in/docs/',
    brokerageModel: '₹20/order (F&O), zero delivery',
    supportedSegments: ['NSE', 'BSE', 'NFO', 'CDS', 'MCX'],
    envVarsRequired: ['FYERS_APP_ID', 'FYERS_ACCESS_TOKEN'],
  },
  DHAN: {
    name: 'Dhan HQ (API v2)',
    website: 'https://dhan.co',
    apiDocs: 'https://dhanhq.co/docs/v2/',
    brokerageModel: '₹20/order (F&O), zero on delivery',
    supportedSegments: ['NSE', 'BSE', 'NFO', 'CDS', 'MCX'],
    envVarsRequired: ['DHAN_CLIENT_ID', 'DHAN_ACCESS_TOKEN'],
  },
  SHOONYA: {
    name: 'Shoonya by Finvasia',
    website: 'https://shoonya.com',
    apiDocs: 'https://api.shoonya.com/',
    brokerageModel: 'ZERO brokerage on ALL segments',
    supportedSegments: ['NSE', 'BSE', 'NFO', 'CDS', 'MCX', 'NCDEX'],
    envVarsRequired: ['SHOONYA_USER_ID', 'SHOONYA_SESSION_TOKEN'],
  },
  PAPER: {
    name: 'Paper Trading (Simulated)',
    website: 'https://artha.ai',
    apiDocs: 'https://artha.ai/docs/paper-trading',
    brokerageModel: 'Free (no real money)',
    supportedSegments: ['NSE', 'BSE', 'NFO', 'MCX'],
    envVarsRequired: [],
  },
};

export interface BrokerFactoryResult {
  adapter: IBrokerAdapter;
  provider: BrokerProvider;
  metadata: typeof BROKER_REGISTRY[BrokerProvider];
  isLive: boolean;
}

/**
 * createBrokerAdapter
 * ───────────────────
 * Reads BROKER_PROVIDER from process.env and constructs the corresponding adapter.
 * Falls back to PAPER mode if the env var is missing or unknown.
 *
 * Usage:
 *   const { adapter, provider } = createBrokerAdapter();
 *   await adapter.placeOrder(request);
 */
export function createBrokerAdapter(env: Record<string, string | undefined> = process.env as any): BrokerFactoryResult {
  const rawProvider = (env.BROKER_PROVIDER || 'PAPER').toUpperCase() as BrokerProvider;
  const provider: BrokerProvider = BROKER_REGISTRY[rawProvider] ? rawProvider : 'PAPER';

  let adapter: IBrokerAdapter;

  switch (provider) {
    case 'ANGELONE':
      adapter = new AngelOneBrokerAdapter(
        env.ANGELONE_CLIENT_ID || env.SMARTAPI_CLIENT_ID || 'simulated-client-id',
        env.ANGELONE_CLIENT_SECRET || env.SMARTAPI_API_KEY || 'simulated-secret',
        env.ANGELONE_PASSWORD || env.SMARTAPI_PASSWORD || 'simulated-pass',
        env.ANGELONE_TOTP_SECRET || env.SMARTAPI_TOTP_SECRET || 'simulated-totp'
      );
      break;

    case 'UPSTOX':
      adapter = new UpstoxBrokerAdapter(
        env.UPSTOX_ACCESS_TOKEN || 'simulated-token'
      );
      break;

    case 'ZERODHA':
      adapter = new ZerodhaBrokerAdapter(
        env.ZERODHA_API_KEY || 'simulated-api-key',
        env.ZERODHA_ACCESS_TOKEN || 'simulated-access-token'
      );
      break;

    case 'FYERS':
      adapter = new FyersBrokerAdapter(
        env.FYERS_APP_ID || 'simulated-app-id',
        env.FYERS_ACCESS_TOKEN || 'simulated-token'
      );
      break;

    case 'DHAN':
      adapter = new DhanBrokerAdapter(
        env.DHAN_CLIENT_ID || 'simulated-client-id',
        env.DHAN_ACCESS_TOKEN || 'simulated-token'
      );
      break;

    case 'SHOONYA':
      adapter = new ShoonyaBrokerAdapter(
        env.SHOONYA_USER_ID || 'simulated-user',
        env.SHOONYA_SESSION_TOKEN || 'simulated-session'
      );
      break;

    case 'PAPER':
    default:
      adapter = new PaperBrokerAdapter();
      break;
  }

  const isLive = adapter.adapter_mode === 'LIVE' && provider !== 'PAPER';
  console.log(`[BrokerFactory] Active Broker: ${BROKER_REGISTRY[provider].name} | Mode: ${isLive ? '🔴 LIVE' : '📄 PAPER'}`);

  return {
    adapter,
    provider,
    metadata: BROKER_REGISTRY[provider],
    isLive,
  };
}

/**
 * validateBrokerEnv
 * ─────────────────
 * Checks if all required env vars for the selected broker are present.
 * Returns a list of missing env var names (empty = all good).
 */
export function validateBrokerEnv(env: Record<string, string | undefined> = process.env as any): string[] {
  const rawProvider = (env.BROKER_PROVIDER || 'PAPER').toUpperCase() as BrokerProvider;
  const provider: BrokerProvider = BROKER_REGISTRY[rawProvider] ? rawProvider : 'PAPER';
  const required = BROKER_REGISTRY[provider].envVarsRequired;
  return required.filter(key => !env[key]);
}
