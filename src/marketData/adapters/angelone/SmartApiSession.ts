/**
 * src/marketData/adapters/angelone/SmartApiSession.ts
 * Phase 2C — AngelOne SmartAPI authentication + session management.
 *
 * Responsibilities:
 *   - generateSession() via REST (POST /rest/auth/angelbroking/user/v1/loginByPassword)
 *   - refreshToken()    via REST (POST /rest/auth/angelbroking/jwt/v1/generateTokens)
 *   - Exposes jwtToken and feedToken for WebSocket auth header
 *   - Never throws — all failures return Result<T>
 *
 * SmartAPI auth flow:
 *   1. POST credentials + TOTP → { jwtToken, refreshToken, feedToken }
 *   2. feedToken is passed as header "x-feed-token" on the WebSocket URL
 *   3. jwtToken is used for all REST calls as "Authorization: Bearer <jwt>"
 *   4. JWT expires in ~24h. refreshToken() uses refreshToken to get a new JWT.
 *
 * TOTP is time-based — caller must provide a live TOTP value or a generator fn.
 */

import type { Result }    from '../../../utils/errors';
import { ok, err }        from '../../../utils/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SmartApiCredentials {
  readonly clientId:   string;
  readonly mpin:       string;
  readonly apiKey:     string;
  /** Returns current TOTP value. Called fresh on each login attempt. */
  readonly getTOTP:    () => string;
}

export interface SmartApiTokens {
  readonly jwtToken:     string;
  readonly refreshToken: string;
  readonly feedToken:    string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL        = 'https://apiconnect.angelbroking.com';
const LOGIN_PATH      = '/rest/auth/angelbroking/user/v1/loginByPassword';
const REFRESH_PATH    = '/rest/auth/angelbroking/jwt/v1/generateTokens';
const REQUEST_TIMEOUT = 15_000; // ms

// ─── SmartApiSession ──────────────────────────────────────────────────────────

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

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(): Promise<Result<SmartApiTokens>> {
    const body = {
      clientcode: this.creds.clientId,
      password:   this.creds.mpin,
      totp:       this.creds.getTOTP(),
    };

    const result = await this.post<{
      status:  boolean;
      message: string;
      data:    { jwtToken: string; refreshToken: string; feedToken: string } | null;
    }>(LOGIN_PATH, body);

    if (!result.ok) return result;

    const resp = result.value;
    if (!resp.status || !resp.data) {
      return err({
        type:    'AuthError',
        reason:  resp.message?.toLowerCase().includes('totp') ? 'missing_totp'
               : resp.message?.toLowerCase().includes('invalid')  ? 'invalid_credentials'
               : 'unknown',
        message: `SmartAPI login failed: ${resp.message ?? 'no message'}`,
      });
    }

    this._tokens = {
      jwtToken:     resp.data.jwtToken,
      refreshToken: resp.data.refreshToken,
      feedToken:    resp.data.feedToken,
    };

    return ok(this._tokens);
  }

  // ─── Token refresh ────────────────────────────────────────────────────────

  async refresh(): Promise<Result<SmartApiTokens>> {
    if (!this._tokens) {
      return err({
        type:    'AuthError',
        reason:  'unknown',
        message: 'Cannot refresh: no existing session. Call login() first.',
      });
    }

    const body = {
      refreshToken: this._tokens.refreshToken,
    };

    const result = await this.post<{
      status:  boolean;
      message: string;
      data:    { jwtToken: string; refreshToken: string; feedToken: string } | null;
    }>(REFRESH_PATH, body, this._tokens.jwtToken);

    if (!result.ok) return result;

    const resp = result.value;
    if (!resp.status || !resp.data) {
      // Refresh token itself may be expired — trigger full re-login
      return err({
        type:    'AuthError',
        reason:  'expired_token',
        message: `SmartAPI token refresh failed: ${resp.message ?? 'no message'}`,
      });
    }

    this._tokens = {
      jwtToken:     resp.data.jwtToken,
      refreshToken: resp.data.refreshToken,
      feedToken:    resp.data.feedToken,
    };

    return ok(this._tokens);
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  invalidate(): void {
    this._tokens = null;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async post<T>(
    path:       string,
    body:       Record<string, unknown>,
    jwtOverride?: string,
  ): Promise<Result<T>> {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const headers: Record<string, string> = {
        'Content-Type':    'application/json',
        'Accept':          'application/json',
        'X-UserType':      'USER',
        'X-SourceID':      'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP':'127.0.0.1',
        'X-MACAddress':    '00:00:00:00:00:00',
        'X-PrivateKey':    this.creds.apiKey,
      };
      if (jwtOverride) {
        headers['Authorization'] = `Bearer ${jwtOverride}`;
      }

      const res = await fetch(`${BASE_URL}${path}`, {
        method:  'POST',
        headers,
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });

      if (!res.ok) {
        return err({
          type:       'NetworkError',
          statusCode: res.status,
          endpoint:   path,
          message:    `HTTP ${res.status} from ${path}`,
        });
      }

      const json = await res.json() as T;
      return ok(json);

    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        return err({
          type:      'TimeoutError',
          operation: `POST ${path}`,
          timeoutMs: REQUEST_TIMEOUT,
          message:   `Request to ${path} timed out after ${REQUEST_TIMEOUT}ms`,
        });
      }
      return err({
        type:    'NetworkError',
        endpoint: path,
        message: `Fetch failed for ${path}: ${e instanceof Error ? e.message : String(e)}`,
        cause:   e instanceof Error ? e : undefined,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
