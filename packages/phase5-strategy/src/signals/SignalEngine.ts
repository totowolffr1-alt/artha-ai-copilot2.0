import { IndicatorPipeline, IndicatorSnapshot } from '../indicators/IndicatorPipeline';
import { SignalEvent, SignalDirection, SignalStrength } from './SignalEvent';
import { RegimeEngine, RegimeClassification } from './RegimeEngine';
import { PositionSizer } from './PositionSizer';

export class SignalEngine {
  private readonly pipelines = new Map<string, IndicatorPipeline>();
  private readonly prevRsi = new Map<string, number>();
  private readonly regimeEngine = new RegimeEngine();
  private readonly positionSizer = new PositionSizer();
  private portfolioEquity: number = 1000000; // Default ₹1,000,000 for sizing

  setPortfolioEquity(equity: number): void {
    this.portfolioEquity = Math.max(0, equity);
  }

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

    // Evaluate current market regime
    const regime = this.regimeEngine.classify(snap, close);

    // Suppress signals during indicator/regime warmup
    if (regime.label === 'WARMUP') {
      this.prevRsi.set(symbol, snap.rsi14);
      return null;
    }

    const prevRsiVal = this.prevRsi.get(symbol) ?? NaN;
    this.prevRsi.set(symbol, snap.rsi14);

    let direction: SignalDirection | null = null;
    let confidence = regime.confidence;
    let strength: SignalStrength = 'WEAK';

    const rsiCrossedUp = !isNaN(prevRsiVal) && prevRsiVal < 35 && snap.rsi14 >= 35;
    const rsiCrossedDown = !isNaN(prevRsiVal) && prevRsiVal > 65 && snap.rsi14 <= 65;
    const rsiRisingFromOversold = !isNaN(prevRsiVal) && prevRsiVal < 40 && snap.rsi14 >= prevRsiVal;
    const rsiFallingFromOverbought = !isNaN(prevRsiVal) && prevRsiVal > 60 && snap.rsi14 <= prevRsiVal;
    const rsiRisingInUptrend = !isNaN(prevRsiVal) && snap.rsi14 > prevRsiVal && snap.rsi14 < 88;
    const rsiFallingInDowntrend = !isNaN(prevRsiVal) && snap.rsi14 < prevRsiVal && snap.rsi14 > 20;

    // ─────────────────────────────────────────────────────────────
    // REGIME-CONDITIONAL SIGNAL EVALUATION RULES
    // ─────────────────────────────────────────────────────────────

    if (regime.label === 'TRENDING_UP') {
      // Long signals favoured in uptrend on dip recovery or momentum turn
      if ((rsiCrossedUp || rsiRisingFromOversold || rsiRisingInUptrend) && snap.macd.histogram > 0) {
        direction = 'LONG';
        confidence = Math.min(100, confidence + 15);
        strength = close > snap.ema50 ? 'STRONG' : 'MODERATE';
      }
    } else if (regime.label === 'TRENDING_DOWN') {
      // Short signals favoured in downtrend on rally failure or momentum turn
      if ((rsiCrossedDown || rsiFallingFromOverbought || rsiFallingInDowntrend) && snap.macd.histogram < 0) {
        direction = 'SHORT';
        confidence = Math.min(100, confidence + 15);
        strength = close < snap.ema50 ? 'STRONG' : 'MODERATE';
      }
    } else if (regime.label === 'SIDEWAYS') {
      // Mean-reversion signals in sideways range
      if (rsiCrossedUp && snap.macd.histogram > -0.5) {
        direction = 'LONG';
        confidence = 70;
        strength = 'MODERATE';
      } else if (rsiCrossedDown && snap.macd.histogram < 0.5) {
        direction = 'SHORT';
        confidence = 70;
        strength = 'MODERATE';
      }
    } else if (regime.label === 'HIGH_VOLATILITY') {
      // Conservative entries only on explicit RSI breakout or strong momentum turn
      if ((rsiCrossedUp || rsiRisingInUptrend) && snap.macd.histogram > 0 && close > snap.ema20) {
        direction = 'LONG';
        confidence = 60;
        strength = 'WEAK';
      } else if ((rsiCrossedDown || rsiFallingInDowntrend) && snap.macd.histogram < 0 && close < snap.ema20) {
        direction = 'SHORT';
        confidence = 60;
        strength = 'WEAK';
      }
    } else if (regime.label === 'LOW_VOLATILITY') {
      // Pre-breakout setup: long if EMA20 > EMA50, short if EMA20 < EMA50
      if (rsiCrossedUp && snap.ema20 >= snap.ema50) {
        direction = 'LONG';
        confidence = 75;
        strength = 'STRONG';
      } else if (rsiCrossedDown && snap.ema20 < snap.ema50) {
        direction = 'SHORT';
        confidence = 75;
        strength = 'STRONG';
      }
    }

    if (!direction) return null;

    // Dynamic SL/TP ATR multipliers based on regime & mode
    const mode = process.env.TRADING_MODE || 'INTRADAY';
    let stopMultiplier = mode === 'SWING' ? 3.5 : 2.0;
    let targetMultiplier = mode === 'SWING' ? 5.0 : 3.0;

    // Expand stops in HIGH_VOLATILITY to prevent whipsaw losses
    if (regime.label === 'HIGH_VOLATILITY') {
      stopMultiplier *= 1.4;
      targetMultiplier *= 1.4;
    }

    const stopDistance = snap.atr14 * stopMultiplier;
    const targetDistance = snap.atr14 * targetMultiplier;

    const stop_loss = direction === 'LONG' ? close - stopDistance : close + stopDistance;
    const take_profit = direction === 'LONG' ? close + targetDistance : close - targetDistance;

    // Calculate dynamic position size
    const sizingResult = this.positionSizer.calculate({
      portfolioEquity: this.portfolioEquity,
      entryPrice: close,
      stopLossPrice: stop_loss,
      atr14: snap.atr14,
    });

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
      regime: regime.label,
      regime_confidence: regime.confidence,
      recommended_qty: sizingResult.recommendedQty,
      risk_amount: sizingResult.riskAmount,
      kelly_fraction: sizingResult.kellyFraction,
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

