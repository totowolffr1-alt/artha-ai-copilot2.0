import { TokenRegistry } from '../packages/phase2-market-data/src/marketData/adapters/angelone/TokenRegistry';

async function test() {
  const registry = new TokenRegistry();
  console.log('Resolving CUPID on NSE...');
  const res = await registry.resolve('CUPID', 'NSE');
  console.log('Result:', res);
}

test().catch(console.error);
