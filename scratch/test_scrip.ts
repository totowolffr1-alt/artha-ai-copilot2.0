async function test() {
  const url = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
  console.log('Fetching scrip master...');
  const res = await fetch(url);
  const data = await res.json() as any[];
  console.log('Total entries:', data.length);
  const cupid = data.filter(d => d.symbol.includes('CUPID'));
  console.log('CUPID matches:', cupid);
}

test().catch(console.error);
