/**
 * packages/phase7-broker/src/adapters/AngelOneAuthManager.ts
 * Artha AI — Phase 7 Angel One Authentication Manager
 */

import { createHmac } from 'crypto';

export class AngelOneAuthManager {
  private jwtToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly passwordSecret: string,
    private readonly totpSecret: string
  ) {}

  /**
   * Get the active JWT token.
   * If token is missing or expired, performs login.
   */
  async getAuthToken(): Promise<string> {
    const now = Date.now();
    if (this.jwtToken && now < this.tokenExpiry) {
      return this.jwtToken;
    }

    await this.login();
    return this.jwtToken!;
  }

  /**
   * Logs in to Angel One SmartAPI using client ID, password, and TOTP.
   */
  private async login(): Promise<void> {
    // If credentials are dummy/mock placeholders, use simulated authentication
    if (!this.clientId || this.clientId.includes('your_') || !this.totpSecret) {
      console.log('[AngelOneAuth] Warning: Using simulated auth token (offline mode).');
      this.jwtToken = 'simulated-jwt-token-' + Math.random().toString(36).substring(2);
      this.tokenExpiry = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
      return;
    }

    try {
      // Generate TOTP dynamically using RFC 6238 (30-second window, SHA-1, 6 digits)
      const totpCode = await this.generateTOTP(this.totpSecret);

      const clientIp = (process.env.ANGELONE_STATIC_IP || process.env.SMARTAPI_STATIC_IP || '13.57.136.86').trim();
      const response = await fetch('https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientIP': clientIp,
          'X-LocalIP': clientIp,
          'clientlocalip': clientIp,
          'clientpublicip': clientIp,
          'X-MACAddress': '00-00-00-00-00-00',
          'X-PrivateKey': this.clientSecret
        },
        body: JSON.stringify({
          clientcode: this.clientId,
          password: this.passwordSecret,
          totp: totpCode
        })
      });

      if (!response.ok) {
        throw new Error(`Login failed with status ${response.status}`);
      }

      const data = await response.json() as any;
      if (data && data.status && data.data && data.data.jwtToken) {
        this.jwtToken = data.data.jwtToken;
        this.tokenExpiry = Date.now() + 2 * 60 * 60 * 1000; // expires in 2 hours
      } else {
        throw new Error(data.message || 'Invalid API response format during login');
      }
    } catch (err: any) {
      console.error('[AngelOneAuth] Error during login:', err.message);
      // Fallback to offline mode instead of crashing the process
      this.jwtToken = 'offline-session-fallback';
      this.tokenExpiry = Date.now() + 5 * 60 * 1000; // retry soon
    }
  }

  /**
   * Generates a 6-digit TOTP code using RFC 6238 (HMAC-SHA1, 30-second window).
   * Compatible with Google Authenticator and Angel One SmartAPI.
   * @param secret Base32-encoded TOTP secret from Angel One developer portal
   */
  private async generateTOTP(secret: string): Promise<string> {
    try {
      // Decode base32 secret
      const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const cleanSecret = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
      const bits: number[] = [];
      for (const char of cleanSecret) {
        const val = base32chars.indexOf(char);
        if (val === -1) continue;
        for (let i = 4; i >= 0; i--) bits.push((val >> i) & 1);
      }
      const bytes = new Uint8Array(Math.floor(bits.length / 8));
      for (let i = 0; i < bytes.length; i++) {
        let byte = 0;
        for (let b = 0; b < 8; b++) byte = (byte << 1) | (bits[i * 8 + b] ?? 0);
        bytes[i] = byte;
      }

      // Calculate counter (30-second window)
      const counter = Math.floor(Date.now() / 1000 / 30);
      const counterBuffer = Buffer.alloc(8);
      counterBuffer.writeBigUInt64BE(BigInt(counter));

      // HMAC-SHA1
      const hmac = createHmac('sha1', Buffer.from(bytes));
      hmac.update(counterBuffer);
      const digest = hmac.digest();

      // Dynamic truncation
      const offset = digest[digest.length - 1]! & 0x0f;
      const code =
        ((digest[offset]! & 0x7f) << 24) |
        ((digest[offset + 1]! & 0xff) << 16) |
        ((digest[offset + 2]! & 0xff) << 8) |
        (digest[offset + 3]! & 0xff);

      return String(code % 1_000_000).padStart(6, '0');
    } catch (e) {
      console.error('[AngelOneAuth] TOTP generation failed:', e);
      return '000000'; // will fail login, triggers offline fallback
    }
  }
}
