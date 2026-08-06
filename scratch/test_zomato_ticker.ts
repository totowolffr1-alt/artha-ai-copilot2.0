async function test() {
  const symbols = ['ZOMATO.NS', 'ETERNAL.NS'];
  for (const s of symbols) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=1d&interval=1m`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`${s}: status = ${res.status}`);
      const json = await res.json() as any;
      console.log(`Response for ${s}:`, json?.chart?.result?.[0]?.meta?.shortName || json?.chart?.error);
    } catch (e: any) {
      console.log(`${s}: failed with ${e.message}`);
    }
  }
}

test().catch(console.error);
