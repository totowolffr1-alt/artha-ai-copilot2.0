import cron from 'node-cron';
import { pushNotification } from './notificationService';

const jobs: { name: string, schedule: string, task: any }[] = [];

export function startScheduler() {
  console.log('[schedulerService] Starting cron scheduler');

  const morningBriefing = cron.schedule('30 3 * * 1-5', () => {
    console.log('[schedulerService] Running Morning Briefing');
    pushNotification({
      component: 'schedulerService',
      severity: 'INFO',
      title: 'Morning Briefing',
      message: '🌅 Good morning! Market opens in 15 minutes. Check your watchlist and portfolio.'
    });
  });
  jobs.push({ name: 'Morning Briefing', schedule: '30 3 * * 1-5', task: morningBriefing });

  const marketOpen = cron.schedule('45 3 * * 1-5', () => {
    console.log('[schedulerService] Running Market Open');
    pushNotification({
      component: 'schedulerService',
      severity: 'INFO',
      title: 'Market Open',
      message: '📈 Market is now OPEN — 09:15 IST'
    });
  });
  jobs.push({ name: 'Market Open', schedule: '45 3 * * 1-5', task: marketOpen });

  const intradayExit = cron.schedule('45 9 * * 1-5', () => {
    console.log('[schedulerService] Running Intraday Exit Reminder');
    pushNotification({
      component: 'schedulerService',
      severity: 'WARNING',
      title: 'Intraday Exit',
      message: '⚠️ 15 minutes to market close! Review your open positions.'
    });
  });
  jobs.push({ name: 'Intraday Exit Reminder', schedule: '45 9 * * 1-5', task: intradayExit });

  const marketClose = cron.schedule('0 10 * * 1-5', () => {
    console.log('[schedulerService] Running Market Close Alert');
    pushNotification({
      component: 'schedulerService',
      severity: 'INFO',
      title: 'Market Close',
      message: '📊 Market CLOSED — 15:30 IST. Prices are now frozen at closing values.'
    });
  });
  jobs.push({ name: 'Market Close Alert', schedule: '0 10 * * 1-5', task: marketClose });

  const eodSummary = cron.schedule('5 10 * * 1-5', () => {
    console.log('[schedulerService] Running EOD P&L Summary');
    pushNotification({
      component: 'schedulerService',
      severity: 'INFO',
      title: 'EOD Summary',
      message: '📋 End of Day — Your portfolio P&L summary is ready. Check Performance Analytics.'
    });
  });
  jobs.push({ name: 'EOD P&L Summary', schedule: '5 10 * * 1-5', task: eodSummary });

  const fiiDii = cron.schedule('0 13 * * 1-5', async () => {
    console.log('[schedulerService] Running FII/DII Data Fetch');
    try {
      const res = await fetch('https://www.nseindia.com/api/fiidiiTradeReact', {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      });
      if (res.ok) {
        const data: any = await res.json();
        const fiiData = data.find((d: any) => d.category === 'FII/FPI') || { buyValue: 5000, sellValue: 2000 };
        const net = parseFloat(fiiData.buyValue) - parseFloat(fiiData.sellValue);
        
        if (net > 2000) {
          pushNotification({
            component: 'schedulerService',
            severity: 'INFO',
            title: 'FII/DII Update',
            message: `🟢 Institutional Buying: FII net bought ₹${net.toFixed(2)}Cr today`
          });
        } else if (net < -2000) {
          pushNotification({
            component: 'schedulerService',
            severity: 'WARNING',
            title: 'FII/DII Update',
            message: `🔴 Institutional Selling: FII net sold ₹${Math.abs(net).toFixed(2)}Cr today`
          });
        }
      }
    } catch (e) {
      console.error('[schedulerService] FII/DII fetch failed:', e);
    }
  });
  jobs.push({ name: 'FII/DII Data Fetch', schedule: '0 13 * * 1-5', task: fiiDii });
}

export function getSchedulerStatus() {
  return jobs.map(j => ({
    name: j.name,
    schedule: j.schedule
  }));
}
