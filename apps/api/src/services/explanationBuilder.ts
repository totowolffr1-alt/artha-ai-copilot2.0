import { ConfidenceReport } from './confidenceEngine';

export interface ReasoningStep {
  step: number;
  signal: string;
  finding: string;
  implication: string;
  weight: string;
  verdict: string;
}

export interface ExplanationReport {
  symbol: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  confidenceLabel: string;
  summary: string;
  reasoningChain: ReasoningStep[];
  keyRisk: string;
  watchLevels: { resistance: number; support: number };
}

export function buildExplanation(report: ConfidenceReport): ExplanationReport {
  const { symbol, direction, confidence, confidenceLabel, signals, conflicts, price } = report;

  const reasoningChain: ReasoningStep[] = [
    {
      step: 1,
      signal: 'RSI',
      finding: `RSI is ${signals.rsi.value}`,
      implication: signals.rsi.message,
      weight: '20%',
      verdict: signals.rsi.condition === direction ? 'SUPPORTS direction' : 'CONTRADICTS direction',
    },
    {
      step: 2,
      signal: 'MACD',
      finding: `MACD value is ${signals.macd.value}`,
      implication: signals.macd.message,
      weight: '25%',
      verdict: signals.macd.condition === direction ? 'SUPPORTS direction' : 'CONTRADICTS direction',
    },
    {
      step: 3,
      signal: '200 DMA',
      finding: `Price is ₹${price.toFixed(2)} vs DMA value of ₹${signals.dma200.value}`,
      implication: signals.dma200.message,
      weight: '20%',
      verdict: signals.dma200.condition === direction ? 'SUPPORTS direction' : 'CONTRADICTS direction',
    },
    {
      step: 4,
      signal: 'Volume',
      finding: `Volume ratio is ${signals.volume.value}`,
      implication: signals.volume.message,
      weight: '15%',
      verdict: signals.volume.condition === direction ? 'SUPPORTS direction' : 'CONTRADICTS direction',
    },
    {
      step: 5,
      signal: 'News Sentiment',
      finding: `News sentiment is ${signals.news.value}`,
      implication: signals.news.message,
      weight: '20%',
      verdict: signals.news.condition === direction ? 'SUPPORTS direction' : 'CONTRADICTS direction',
    },
  ];

  // Auto-calculate realistic support and resistance levels based on price
  const support = parseFloat((price * 0.965).toFixed(2));
  const resistance = parseFloat((price * 1.035).toFixed(2));

  // Determine key risk
  let keyRisk = 'Standard market volatility.';
  if (conflicts.length > 0) {
    keyRisk = conflicts[0];
  } else if (signals.volume.condition === 'BEARISH') {
    keyRisk = 'Thin volume backoff — the current price move lacks institutional buying volume backing.';
  } else if (signals.rsi.condition === 'BEARISH') {
    keyRisk = 'Extremely high RSI indicates overbought condition — watch out for a potential near-term drop.';
  } else if (direction === 'BULLISH' && price < Number(signals.dma200.value)) {
    keyRisk = 'Stock shows short-term momentum, but remains below the long-term 200 DMA resistance.';
  }

  // Build clean summary
  const supportSignals = Object.values(signals).filter(s => s.condition === direction).length;
  const summary = `Analysis for ${symbol} indicates a ${direction} setup with ${confidence}% confidence (${confidenceLabel}). ` +
    `Specifically, ${supportSignals} out of 5 core quantitative indicators align with the ${direction.toLowerCase()} direction. ` +
    `${signals.macd.message} ${signals.rsi.message}`;

  return {
    symbol,
    direction,
    confidence,
    confidenceLabel,
    summary,
    reasoningChain,
    keyRisk,
    watchLevels: { resistance, support },
  };
}
