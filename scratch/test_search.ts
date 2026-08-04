import { AngelOneAuthManager } from '../packages/phase7-broker/src/adapters/AngelOneAuthManager';

async function test() {
  // Load .env
  import('dotenv').then(async (dotenv) => {
    dotenv.config({ path: '../.env' });
    dotenv.config({ path: './.env' });
    
    const clientId = process.env.ANGELONE_CLIENT_ID || '';
    const clientSecret = process.env.ANGELONE_CLIENT_SECRET || '';
    const passwordSecret = process.env.ANGELONE_PASSWORD || '';
    const totpSecret = process.env.ANGELONE_TOTP_SECRET || '';

    console.log('Credentials loaded:');
    console.log('Client ID:', clientId);
    console.log('TOTP Secret:', totpSecret ? 'SET' : 'MISSING');

    const auth = new AngelOneAuthManager(clientId, clientSecret, passwordSecret, totpSecret);
    console.log('Logging in...');
    const token = await auth.getAuthToken();
    console.log('JWT Token:', token);

    if (token && token !== 'offline-session-fallback') {
      console.log('Searching for CUPID...');
      const res = await fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/searchScrip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientIP': '127.0.0.1',
          'X-MACAddress': '00-00-00-00-00-00',
          'X-PrivateKey': clientSecret
        },
        body: JSON.stringify({ exchange: 'NSE', searchscrip: 'CUPID' })
      });
      const data = await res.json() as any;
      console.log('Search response:', JSON.stringify(data, null, 2));
    }
  });
}

test().catch(console.error);
