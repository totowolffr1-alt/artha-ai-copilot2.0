import { IndicatorPipeline, IndicatorSnapshot } from '../indicators/IndicatorPipeline';
import { SignalEvent, SignalDirection, SignalStrength } from './SignalEvent';

export class SignalEngine {
  private readonly pipelines = new Map<string, IndicatorPipeline>();
  private readonly prevRsi = new Map<string, number>();

  /**
   * Processes a bar event. If a signal is generated, returns it. Otherwise returns null.
   */
  processBar(
    symbol: string,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
    barTs: Date = new Date()
  ): SignalEvent | null {
    if (!this.pipelines.has(symbol)) {
      this.pipelines.set(symbol, new IndicatorPipeline());
    }

    const pipeline = this.pipelines.get(symbol)!;
    const snap = pipeline.feed(open, high, low, close, volume);

    // Make sure indicators have warmed up (e.g., ema50 must not be NaN)
    if (isNaN(snap.ema50) || isNaN(snap.rsi14) || isNaN(snap.macd.histogram) || isNaN(snap.atr14)) {
      this.prevRsi.set(symbol, snap.rsi14);
      return null;
    }

    const prevRsiVal = this.prevRsi.get(symbol) ?? NaN;
    this.prevRsi.set(symbol, snap.rsi14);

    let direction: SignalDirection | null = null;
    let confidence = 0;
    let strength: SignalStrength = 'WEAK';

    // BUY Signal logic: RSI crossing up out of oversold (< 35) + MACD hist positive + price above EMA20
    if (!isNaN(prevRsiVal) && prevRsiVal < 35 && snap.rsi14 >= 35) {
      if (snap.macd.histogram > 0 && close > snap.ema20) {
        direction = 'LONG';
        confidence = 70;
        if (close > snap.ema50) {
          confidence += 15;
          strength = 'STRONG';
        } else {
          strength = 'MODERATE';
        }
      }
    }

    // SELL Signal logic: RSI crossing down out of overbought (> 65) + MACD hist negative + price below EMA20
    if (!isNaN(prevRsiVal) && prevRsiVal > 65 && snap.rsi14 <= 65) {
      if (snap.macd.histogram < 0 && close < snap.ema20) {
        direction = 'SHORT';
        confidence = 70;
        if (close < snap.ema50) {
          confidence += 15;
          strength = 'STRONG';
        } else {
          strength = 'MODERATE';
        }
      }
    }

    if (!direction) return null;

    // Determine multipliers dynamically based on active trading mode
    const mode = process.env.TRADING_MODE || 'INTRADAY';
    const stopMultiplier = mode === 'SWING' ? 3.5 : 2.0;
    const targetMultiplier = mode === 'SWING' ? 5.0 : 3.0;

    const stopDistance = snap.atr14 * stopMultiplier;
    const targetDistance = snap.atr14 * targetMultiplier;

    const stop_loss = direction === 'LONG' ? close - stopDistance : close + stopDistance;
    const take_profit = direction === 'LONG' ? close + targetDistance : close - targetDistance;

    const generatedSignal: SignalEvent = {
      signal_id: `sig-${Math.random().toString(36).substring(2, 11)}`,
      symbol,
      exchange: 'NSE',
      direction,
      strength,
      confidence,
      entry_price: close,
      stop_loss,
      take_profit,
      rsi: snap.rsi14,
      macd_hist: snap.macd.histogram,
      atr: snap.atr14,
      ema20: snap.ema20,
      ema50: snap.ema50,
      emitted_at: new Date(),
      bar_ts: barTs
    };

    return generatedSignal;
  }

  resetSymbol(symbol: string): void {
    this.pipelines.get(symbol)?.reset();
    this.prevRsi.delete(symbol);
  }
}
