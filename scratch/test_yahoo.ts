async function test() {
  const symbols = ['RELIANCE', 'TCS', 'INFY', 'CUPID', 'ZOMATO', 'SILVERBEES'];
  for (const s of symbols) {
    const ticker = `${s}.NS`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1m`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`${s}: status = ${res.status}`);
      if (res.status !== 200) {
        const text = await res.text();
        console.log(`Error body for ${s}:`, text);
      }
    } catch (e: any) {
      console.log(`${s}: failed with ${e.message}`);
    }
  }
}

test().catch(console.error);
