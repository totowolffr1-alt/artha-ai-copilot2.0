/**
 * yahooMapper.ts — Maps local broker symbols to Yahoo Finance symbols
 */

export function toYahooTicker(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  // ZOMATO is represented as ETERNAL.NS on Yahoo Finance
  if (upper === 'ZOMATO') return 'ETERNAL.NS';
  if (upper === 'ZOMATO.NS') return 'ETERNAL.NS';
  return upper.includes('.') ? upper : `${upper}.NS`;
}

export function fromYahooTicker(ticker: string): string {
  const upper = ticker.toUpperCase().trim();
  if (upper === 'ETERNAL.NS') return 'ZOMATO';
  return upper.split('.')[0] || upper;
}
