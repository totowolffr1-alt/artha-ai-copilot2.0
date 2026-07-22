import { pushNotification } from './notificationService';
import { addEvent } from './systemTimeline';
import { priceAlerts } from '../db/sqlite';

let _portfolioHoldings: any[] = [];
let _watchlistSymbols: string[] = [];
const processedNews = new Map<string, number>();

export function updatePortfolioHoldings(holdings: any[]) {
  _portfolioHoldings = holdings;
}

export function updateWatchlist(symbols: string[]) {
  _watchlistSymbols = symbols;
}

export function checkStopLossHits(currentPrices: Record<string, number>) {
  for (const holding of _portfolioHoldings) {
    if (holding.stop_loss && currentPrices[holding.symbol]) {
      if (currentPrices[holding.symbol] <= holding.stop_loss) {
        pushNotification({
          component: 'tradingAlertService',
          severity: 'HIGH',
          title: 'Stop Loss Hit',
          message: `🛑 ${holding.symbol} — Stop Loss Hit at ₹${currentPrices[holding.symbol]}`
        });
        addEvent('tradingAlertService', 'Stop Loss Hit', 'HIGH', `${holding.symbol} at ${currentPrices[holding.symbol]}`);
      }
    }
  }
}

export function checkPriceAlerts(currentPrices: Record<string, number>) {
  const activeAlerts = priceAlerts.getActive();
  for (const alert of activeAlerts) {
    const price = currentPrices[alert.symbol];
    if (!price) continue;
    
    let triggered = false;
    if (alert.condition === 'ABOVE' && price >= alert.target_price) {
      triggered = true;
    } else if (alert.condition === 'BELOW' && price <= alert.target_price) {
      triggered = true;
    }
    
    if (triggered) {
      pushNotification({
        component: 'tradingAlertService',
        severity: 'HIGH',
        title: 'Price Alert',
        message: `🎯 ${alert.symbol} reached target ₹${alert.target_price} (Current: ₹${price})`
      });
      priceAlerts.trigger(alert.id);
    }
  }
}

export function checkPortfolioNews(newsHeadlines: Array<{title: string, symbols?: string[]}>) {
  const now = Date.now();
  const allSymbols = new Set([..._portfolioHoldings.map(h => h.symbol), ..._watchlistSymbols]);
  
  for (const news of newsHeadlines) {
    if (!news.symbols) continue;
    
    for (const sym of news.symbols) {
      if (allSymbols.has(sym)) {
        const dedupKey = `${sym}:${news.title}`;
        const lastTime = processedNews.get(dedupKey);
        
        if (!lastTime || now - lastTime > 60 * 60 * 1000) {
          pushNotification({
            component: 'tradingAlertService',
            severity: 'INFO',
            title: 'News Alert',
            message: `📰 ${sym} — ${news.title}`
          });
          processedNews.set(dedupKey, now);
        }
      }
    }
  }
}

setInterval(() => {
  const dummyPrices: Record<string, number> = {}; 
  checkStopLossHits(dummyPrices);
  try {
    checkPriceAlerts(dummyPrices);
  } catch (e) {}
}, 60000);
