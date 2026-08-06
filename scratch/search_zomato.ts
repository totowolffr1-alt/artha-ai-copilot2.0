async function test() {
  const q = 'zomato';
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json() as any;
    console.log('Search results for zomato:', JSON.stringify(data.quotes, null, 2));
  } catch (e: any) {
    console.log('Failed:', e.message);
  }
}

test().catch(console.error);
