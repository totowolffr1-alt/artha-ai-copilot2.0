import { useEffect, useState } from 'react';
import { getNews } from '../services/api';

interface CorporateEventItem {
  symbol: string;
  eventType: string;
  date: string;
  description: string;
  blackoutHours: number;
}

const SAMPLE_EVENTS: CorporateEventItem[] = [
  { symbol: 'RELIANCE', eventType: 'BOARD_MEETING', date: '2026-07-22', description: 'Financial results & dividend consideration', blackoutHours: 48 },
  { symbol: 'TCS', eventType: 'EARNINGS', date: '2026-07-25', description: 'Q1 Earnings Release', blackoutHours: 48 },
  { symbol: 'INFY', eventType: 'AGM', date: '2026-07-28', description: 'Annual General Meeting', blackoutHours: 24 },
  { symbol: 'ABC', eventType: 'SEBI_NOTICE', date: '2026-07-30', description: 'SEBI advisory update', blackoutHours: 72 }
];

export default function NewsIntelligence() {
  const [items, setItems] = useState<Array<{ headline: string; source: string; sentiment: string }>>([]);
  const [events, setEvents] = useState<CorporateEventItem[]>(SAMPLE_EVENTS);

  useEffect(() => {
    getNews().then(setItems).catch(() => {});
  }, []);

  return (
    <div>
      <h2>News & Event Intelligence</h2>
      <p className="description">
        Scans news sentiment feeds and maps quarterly corporate event schedules to prevent execution lag and pre-earnings spikes.
      </p>

      {/* Corporate Blackout Alerts */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 30 }}>
        <div style={{ padding: '24px 24px 10px 24px' }}>
          <h3 style={{ color: '#fff', fontSize: 17 }}>Upcoming Corporate Event Blackouts</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            Trading signals for these symbols will be automatically suppressed by the NewsEventGuard during blackout periods.
          </p>
        </div>
        <table style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Event Type</th>
              <th>Scheduled Date</th>
              <th>Description</th>
              <th>Blackout Window</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, idx) => (
              <tr key={idx}>
                <td style={{ fontWeight: 600, color: '#fff' }}>{e.symbol}</td>
                <td>
                  <span className={`badge ${e.eventType === 'SEBI_NOTICE' ? 'danger' : ''}`}>{e.eventType}</span>
                </td>
                <td>{e.date}</td>
                <td style={{ color: 'var(--muted)' }}>{e.description}</td>
                <td>{e.blackoutHours} Hours</td>
                <td>
                  <span className="badge success">Blackout Active</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* News Sentiment Scanner */}
      <h3 style={{ color: '#fff', fontSize: 18, marginBottom: 15 }}>Real-Time Sentiment Scanner</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
        {items.map((item, i) => {
          const isPositive = item.sentiment.toLowerCase() === 'positive';
          const isNegative = item.sentiment.toLowerCase() === 'negative';
          
          return (
            <div className="card" key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '80%' }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>{item.headline}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Source: {item.source}</div>
              </div>
              <span className={`badge ${isPositive ? 'success' : isNegative ? 'danger' : ''}`} style={{ width: 90 }}>
                {item.sentiment}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
