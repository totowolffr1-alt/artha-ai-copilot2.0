import fs from 'fs';
import path from 'path';

export interface ConfidenceHistoryRecord {
  id: string;
  symbol: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  priceAtSignal: number;
  timestamp: string;
  outcomeChecked: boolean;
  outcomeDirection?: 'SUCCESS' | 'FAILED' | 'NEUTRAL';
  priceAfterNPeriod?: number;
}

const DATA_DIR = path.resolve(__dirname, '../../data');
const HISTORY_FILE = path.join(DATA_DIR, 'confidence_history.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let historyState: ConfidenceHistoryRecord[] = [];

function loadHistory(): void {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
      historyState = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[ConfidenceHistory] Starting fresh history:', err);
  }
}

function saveHistory(): void {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyState, null, 2), 'utf8');
  } catch (err) {
    console.error('[ConfidenceHistory] Save failed:', err);
  }
}

loadHistory();

export const confidenceHistory = {
  log(record: Omit<ConfidenceHistoryRecord, 'id' | 'timestamp' | 'outcomeChecked'>): ConfidenceHistoryRecord {
    const newRecord: ConfidenceHistoryRecord = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      outcomeChecked: false,
      ...record,
    };
    historyState.unshift(newRecord);
    // Keep max 1000 history items to prevent file bloating
    if (historyState.length > 1000) historyState.pop();
    saveHistory();
    return newRecord;
  },

  getAll(): ConfidenceHistoryRecord[] {
    return historyState;
  },

  // Simulates evaluating all unchecked signals against current market prices
  evaluateOutcomes(currentPrices: Record<string, number>): void {
    let changed = false;
    historyState.forEach(record => {
      if (record.outcomeChecked) return;

      const current = currentPrices[record.symbol.toUpperCase()];
      if (!current) return;

      // Evaluate signal outcome (e.g. signal is checked after timestamp or next ticker price)
      // Check if price moved > 1% in the signal direction (BULLISH vs BEARISH)
      const diffPct = ((current - record.priceAtSignal) / record.priceAtSignal) * 100;
      
      let outcome: 'SUCCESS' | 'FAILED' | 'NEUTRAL' = 'NEUTRAL';
      if (record.direction === 'BULLISH') {
        if (diffPct > 0.8) outcome = 'SUCCESS';
        else if (diffPct < -0.8) outcome = 'FAILED';
      } else if (record.direction === 'BEARISH') {
        if (diffPct < -0.8) outcome = 'SUCCESS';
        else if (diffPct > 0.8) outcome = 'FAILED';
      }

      // Mark check only if there's actual change or time elapsed > 1 min
      const minutesElapsed = (Date.now() - new Date(record.timestamp).getTime()) / 60000;
      if (minutesElapsed > 2) {
        record.outcomeChecked = true;
        record.outcomeDirection = outcome;
        record.priceAfterNPeriod = current;
        changed = true;
      }
    });

    if (changed) saveHistory();
  },

  getStats() {
    const checked = historyState.filter(h => h.outcomeChecked);
    const total = checked.length;
    const successes = checked.filter(h => h.outcomeDirection === 'SUCCESS').length;
    const accuracy = total > 0 ? parseFloat(((successes / total) * 100).toFixed(1)) : 100.0;

    // Break down by confidence buckets
    const buckets = {
      high: { total: 0, success: 0 }, // >= 70%
      moderate: { total: 0, success: 0 }, // 50-69%
      low: { total: 0, success: 0 }, // < 50%
    };

    checked.forEach(h => {
      if (h.confidence >= 70) {
        buckets.high.total++;
        if (h.outcomeDirection === 'SUCCESS') buckets.high.success++;
      } else if (h.confidence >= 50) {
        buckets.moderate.total++;
        if (h.outcomeDirection === 'SUCCESS') buckets.moderate.success++;
      } else {
        buckets.low.total++;
        if (h.outcomeDirection === 'SUCCESS') buckets.low.success++;
      }
    });

    return {
      totalSignals: historyState.length,
      evaluatedCount: total,
      overallAccuracy: accuracy,
      buckets: {
        high: buckets.high.total > 0 ? parseFloat(((buckets.high.success / buckets.high.total) * 100).toFixed(1)) : 0,
        moderate: buckets.moderate.total > 0 ? parseFloat(((buckets.moderate.success / buckets.moderate.total) * 100).toFixed(1)) : 0,
        low: buckets.low.total > 0 ? parseFloat(((buckets.low.success / buckets.low.total) * 100).toFixed(1)) : 0,
        highTotal: buckets.high.total,
        moderateTotal: buckets.moderate.total,
        lowTotal: buckets.low.total,
      }
    };
  }
};
