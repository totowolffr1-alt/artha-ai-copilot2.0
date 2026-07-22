/**
 * src/marketData/adapters/angelone/SmartApiSession.ts
 *
 * Modified to route through the shared API brokerSession singleton.
 * Ensures the WebSocket stream uses the exact same JWT, refreshToken,
 * and feedToken cached in brokerSession, preventing duplicate TOTP authentication.
 */

import type { Result } from '../../../utils/errors';
import { ok, err } from '../../../utils/errors';
import {
  getJwtToken,
  getFeedToken,
  getRefreshToken,
} from '../../../../../../apps/api/src/services/brokerSession';

export interface SmartApiCredentials {
  readonly clientId:   string;
  readonly mpin:       string;
  readonly apiKey:     string;
  readonly getTOTP:    () => string;
}

export interface SmartApiTokens {
  readonly jwtToken:     string;
  readonly refreshToken: string;
  readonly feedToken:    string;
}

export class SmartApiSession {
  private _tokens: SmartApiTokens | null = null;

  constructor(private readonly creds: SmartApiCredentials) {}

  get tokens(): SmartApiTokens | null {
    return this._tokens;
  }

  get jwtToken(): string | null {
    return this._tokens?.jwtToken ?? null;
  }

  get feedToken(): string | null {
    return this._tokens?.feedToken ?? null;
  }

  async login(): Promise<Result<SmartApiTokens>> {
    const jwtToken = await getJwtToken();
    const feedToken = getFeedToken();
    const refreshToken = getRefreshToken();

    if (jwtToken && feedToken) {
      this._tokens = {
        jwtToken,
        refreshToken: refreshToken || '',
        feedToken,
      };
      console.log('[SmartApiSession] Cached tokens loaded from shared brokerSession.');
      return ok(this._tokens);
    }

    return err({
      type: 'AuthError',
      reason: 'invalid_credentials',
      message: 'Shared broker session is not pre-authenticated or tokens are missing.',
    });
  }

  async refresh(): Promise<Result<SmartApiTokens>> {
    // Shared brokerSession handles caching and expiry internally. Just reload.
    const jwtToken = await getJwtToken();
    const feedToken = getFeedToken();
    const refreshToken = getRefreshToken();

    if (jwtToken && feedToken) {
      this._tokens = {
        jwtToken,
        refreshToken: refreshToken || '',
        feedToken,
      };
      return ok(this._tokens);
    }

    return err({
      type: 'AuthError',
      reason: 'expired_token',
      message: 'Shared broker session refresh failed.',
    });
  }

  invalidate(): void {
    this._tokens = null;
  }
}
