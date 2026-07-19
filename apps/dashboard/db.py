"""
apps/dashboard/db.py
Artha AI — XAI Dashboard Database Connector

Reads from Phase 3 (PostgreSQL) tables:
  - signals          : trade signal features and outcomes
  - risk_snapshots   : periodic VIX, drawdown, and portfolio heat snapshots
  - drawdown_log     : HWM drawdown records from Phase 6
  - execution_log    : execution results (slippage, costs) from Phase 7
"""

import os
import pandas as pd
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()


def _engine():
    db_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/artha")
    return create_engine(db_url)


# ---------------------------------------------------------------------------
# Signals: the core training & prediction data
# ---------------------------------------------------------------------------

def fetch_signals(limit: int = 5000) -> pd.DataFrame:
    """
    Load historical signals with feature columns extracted from the JSONB
    features column. Returns flat DataFrame with columns:
      id, symbol, direction, status, confidence,
      rsi, macd, macd_signal, bb_upper, bb_lower,
      atr, volume_ratio, created_at, outcome_pnl
    """
    sql = text("""
        SELECT
            id,
            symbol,
            direction,
            status,
            confidence,
            (features->>'rsi')::float          AS rsi,
            (features->>'macd')::float         AS macd,
            (features->>'macd_signal')::float  AS macd_signal,
            (features->>'bb_upper')::float     AS bb_upper,
            (features->>'bb_lower')::float     AS bb_lower,
            (features->>'atr')::float          AS atr,
            (features->>'volume_ratio')::float AS volume_ratio,
            created_at,
            outcome_pnl
        FROM signals
        WHERE status IN ('approved','rejected','suppressed')
        ORDER BY created_at DESC
        LIMIT :limit
    """)
    with _engine().connect() as conn:
        return pd.read_sql(sql, conn, params={"limit": limit})


# ---------------------------------------------------------------------------
# Risk Snapshots
# ---------------------------------------------------------------------------

def fetch_risk_snapshots(days: int = 90) -> pd.DataFrame:
    """
    Load recent periodic risk snapshots for Risk Monitor tab.
    Columns: snapshot_time, nifty_trend, vix_level, portfolio_heat,
             drawdown_pct, regime
    """
    sql = text("""
        SELECT
            snapshot_time,
            nifty_trend,
            vix_level,
            portfolio_heat,
            drawdown_pct,
            regime
        FROM risk_snapshots
        WHERE snapshot_time >= NOW() - INTERVAL ':days days'
        ORDER BY snapshot_time ASC
    """.replace(":days days", f"{days} days"))
    with _engine().connect() as conn:
        return pd.read_sql(sql, conn)


# ---------------------------------------------------------------------------
# Drawdown Log
# ---------------------------------------------------------------------------

def fetch_drawdown_log(days: int = 90) -> pd.DataFrame:
    """Load drawdown history from Phase 6 HWM tracking."""
    sql = text("""
        SELECT
            recorded_at,
            portfolio_value,
            hwm_value,
            drawdown_pct
        FROM drawdown_log
        WHERE recorded_at >= NOW() - INTERVAL ':days days'
        ORDER BY recorded_at ASC
    """.replace(":days days", f"{days} days"))
    with _engine().connect() as conn:
        return pd.read_sql(sql, conn)


# ---------------------------------------------------------------------------
# Execution Log  (slippage + cost analytics)
# ---------------------------------------------------------------------------

def fetch_execution_log(limit: int = 500) -> pd.DataFrame:
    """
    Load Phase 7 execution results including transaction costs and slippage.
    Columns: order_id, symbol, filled_qty, fill_price, estimated_cost,
             spread_slippage_cost, blocked_reason, filled_at
    """
    sql = text("""
        SELECT
            order_id,
            symbol,
            filled_qty,
            fill_price,
            estimated_cost,
            spread_slippage_cost,
            blocked_reason,
            filled_at
        FROM execution_log
        ORDER BY filled_at DESC
        LIMIT :limit
    """)
    with _engine().connect() as conn:
        return pd.read_sql(sql, conn, params={"limit": limit})


# ---------------------------------------------------------------------------
# Demo: Synthetic data fallback (when DB is unavailable)
# ---------------------------------------------------------------------------

def fetch_signals_demo() -> pd.DataFrame:
    """
    Returns synthetic signal data for demo / offline use
    so the dashboard always renders something meaningful.
    """
    import numpy as np
    rng = np.random.default_rng(42)
    n = 500
    rsi    = rng.uniform(20, 80, n)
    macd   = rng.uniform(-5, 5, n)
    atr    = rng.uniform(0.5, 4.0, n)
    volume = rng.uniform(0.5, 3.0, n)
    bb_pos = rng.uniform(0, 1, n)   # position within Bollinger Band

    # Simple synthetic label: bullish when RSI>55 and MACD>0
    direction = ((rsi > 55) & (macd > 0)).astype(int)

    return pd.DataFrame({
        "id": range(n),
        "symbol": rng.choice(["NIFTY", "BANKNIFTY", "RELIANCE", "TCS", "INFY"], n),
        "direction": direction,
        "status": rng.choice(["approved", "rejected", "suppressed"], n, p=[0.6, 0.3, 0.1]),
        "confidence": rng.uniform(0.4, 0.95, n).round(3),
        "rsi": rsi.round(2),
        "macd": macd.round(3),
        "macd_signal": (macd - rng.uniform(-1, 1, n)).round(3),
        "bb_upper": (rng.uniform(100, 200, n)).round(2),
        "bb_lower": (rng.uniform(50, 100, n)).round(2),
        "atr": atr.round(3),
        "volume_ratio": volume.round(3),
        "outcome_pnl": rng.normal(200, 800, n).round(2),
        "created_at": pd.date_range("2025-01-01", periods=n, freq="1h"),
    })


def fetch_risk_snapshots_demo() -> pd.DataFrame:
    import numpy as np
    rng = np.random.default_rng(7)
    n = 90
    base = pd.date_range("2025-04-01", periods=n, freq="1D")
    vix = rng.uniform(12, 32, n).round(2)
    return pd.DataFrame({
        "snapshot_time": base,
        "vix_level": vix,
        "portfolio_heat": rng.uniform(0.1, 0.85, n).round(3),
        "drawdown_pct": rng.uniform(-0.15, 0, n).round(4),
        "regime": rng.choice(["STRONG_BULL", "NEUTRAL", "CAUTION", "HIGH_VOLATILITY"], n),
        "nifty_trend": rng.choice(["UP", "DOWN", "SIDEWAYS"], n),
    })


def fetch_execution_log_demo() -> pd.DataFrame:
    import numpy as np
    rng = np.random.default_rng(3)
    n = 200
    return pd.DataFrame({
        "order_id": [f"ORD{i:04d}" for i in range(n)],
        "symbol": rng.choice(["NIFTY", "BANKNIFTY", "RELIANCE"], n),
        "filled_qty": rng.integers(1, 50, n),
        "fill_price": rng.uniform(100, 500, n).round(2),
        "estimated_cost": rng.uniform(10, 200, n).round(2),
        "spread_slippage_cost": rng.uniform(2, 80, n).round(2),
        "blocked_reason": rng.choice([None, "COST_EXCEEDS_FRICTION", None, None], n),
        "filled_at": pd.date_range("2025-04-01", periods=n, freq="2h"),
    })
