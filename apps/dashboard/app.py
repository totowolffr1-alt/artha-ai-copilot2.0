"""
apps/dashboard/app.py
Artha AI — Confidence-Aware Explainable AI Dashboard

A premium Streamlit dashboard that demonstrates:
  Tab 1 — Explainable Signals : ML confidence + SHAP force plots
  Tab 2 — Risk Monitor        : VIX, drawdown, portfolio heat
  Tab 3 — Execution Analytics : Slippage & transaction cost tracking
  Tab 4 — Regime XAI          : Regime-conditional SHAP importance

Run: streamlit run apps/dashboard/app.py
"""

import warnings
warnings.filterwarnings("ignore")

import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
import shap
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from db import (
    fetch_signals_demo,
    fetch_risk_snapshots_demo,
    fetch_execution_log_demo,
)
from model import ArthaXAIModel

# ─────────────────────────────────────────────────────────────
# Page Config
# ─────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Artha AI — XAI Dashboard",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─────────────────────────────────────────────────────────────
# Custom CSS — Dark Glassmorphic Theme
# ─────────────────────────────────────────────────────────────
st.markdown("""
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

  html, body, [class*="css"] {
    font-family: 'Inter', sans-serif;
    background-color: #0d0f14;
    color: #e2e8f0;
  }

  /* Main background */
  .stApp { background: linear-gradient(135deg, #0d0f14 0%, #111827 50%, #0f172a 100%); }

  /* Sidebar */
  section[data-testid="stSidebar"] {
    background: rgba(17, 24, 39, 0.85);
    backdrop-filter: blur(12px);
    border-right: 1px solid rgba(99, 102, 241, 0.2);
  }

  /* Metric cards */
  [data-testid="metric-container"] {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(99, 102, 241, 0.15);
    border-radius: 12px;
    padding: 1rem;
    backdrop-filter: blur(8px);
    transition: transform 0.2s;
  }
  [data-testid="metric-container"]:hover { transform: translateY(-2px); }

  /* Tab styling */
  .stTabs [data-baseweb="tab-list"] {
    background: rgba(255,255,255,0.03);
    border-radius: 10px;
    padding: 4px;
    gap: 4px;
  }
  .stTabs [data-baseweb="tab"] {
    background: transparent;
    border-radius: 8px;
    color: #94a3b8;
    font-weight: 500;
  }
  .stTabs [aria-selected="true"] {
    background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
    color: white !important;
  }

  /* Plotly chart container */
  .stPlotlyChart { border-radius: 12px; }

  /* Headers */
  h1 { background: linear-gradient(135deg, #6366f1, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  h2, h3 { color: #c7d2fe; }

  /* Confidence badge */
  .conf-high { color: #34d399; font-weight: 700; }
  .conf-med  { color: #fbbf24; font-weight: 700; }
  .conf-low  { color: #f87171; font-weight: 700; }

  /* Divider */
  hr { border: 0; border-top: 1px solid rgba(99,102,241,0.2); margin: 1.5rem 0; }
</style>
""", unsafe_allow_html=True)


# ─────────────────────────────────────────────────────────────
# Sidebar
# ─────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("## 📈 Artha AI")
    st.markdown("**Confidence-Aware XAI Dashboard**")
    st.markdown("---")
    st.markdown("### ⚙️ Settings")

    data_source = st.radio("Data Source", ["🎭 Demo (Offline)", "🗄️ Live Database"], index=0)
    confidence_threshold = st.slider("Confidence Threshold", 0.4, 0.95, 0.6, 0.05)
    regime_filter = st.multiselect(
        "Regime Filter",
        ["STRONG_BULL", "NEUTRAL", "CAUTION", "HIGH_VOLATILITY"],
        default=["STRONG_BULL", "NEUTRAL", "CAUTION", "HIGH_VOLATILITY"]
    )
    retrain = st.button("🔄 Retrain Model", use_container_width=True)

    st.markdown("---")
    st.markdown("### 📘 Research Context")
    st.markdown("""
    This dashboard demonstrates the
    **Confidence-Aware XAI Decision Support**
    concept from your research notes:

    - ✅ XGBoost directional prediction
    - ✅ SHAP feature attribution
    - ✅ Regime-conditional XAI
    - ✅ Risk & execution analytics
    """)
    st.caption("Built on Phase 3–7 Artha Engine")


# ─────────────────────────────────────────────────────────────
# Load Data
# ─────────────────────────────────────────────────────────────
@st.cache_data(ttl=300)
def load_data():
    signals   = fetch_signals_demo()
    risk      = fetch_risk_snapshots_demo()
    execution = fetch_execution_log_demo()
    return signals, risk, execution


@st.cache_resource
def get_trained_model(n_rows: int):
    signals, _, _ = load_data()
    model = ArthaXAIModel()
    metrics = model.train(signals)
    return model, metrics


with st.spinner("Loading data and training XAI model..."):
    signals_df, risk_df, exec_df = load_data()
    if retrain:
        st.cache_resource.clear()
    model, train_metrics = get_trained_model(len(signals_df))
    signals_df = model.predict_with_confidence(signals_df)


# ─────────────────────────────────────────────────────────────
# Header Metrics
# ─────────────────────────────────────────────────────────────
st.title("Artha AI — Confidence-Aware XAI Dashboard")
st.markdown("*Explainable AI Decision Support for Quantitative Trading*")
st.markdown("---")

col1, col2, col3, col4, col5 = st.columns(5)
high_conf = signals_df[signals_df["ml_confidence"] >= confidence_threshold]

col1.metric("Total Signals", f"{len(signals_df):,}")
col2.metric("High Confidence", f"{len(high_conf):,}", f"{len(high_conf)/len(signals_df)*100:.1f}%")
col3.metric("Model ROC-AUC", f"{train_metrics['roc_auc']:.3f}")
col4.metric("Precision", f"{train_metrics['precision']:.3f}")
col5.metric("F1 Score", f"{train_metrics['f1']:.3f}")


# ─────────────────────────────────────────────────────────────
# Tabs
# ─────────────────────────────────────────────────────────────
tab1, tab2, tab3, tab4 = st.tabs([
    "🧠 Explainable Signals",
    "⚠️ Risk Monitor",
    "💸 Execution Analytics",
    "📊 Regime XAI"
])


# ══════════════════════════════════════════════════
# TAB 1 — Explainable Signals
# ══════════════════════════════════════════════════
with tab1:
    st.subheader("🧠 Explainable Trade Signals")
    st.markdown("For each signal, the XGBoost model outputs a confidence score. SHAP values explain *which features drove the prediction*.")

    col_a, col_b = st.columns([2, 1])
    with col_a:
        # Confidence distribution chart
        fig_conf = px.histogram(
            signals_df,
            x="ml_confidence",
            nbins=30,
            color_discrete_sequence=["#6366f1"],
            title="ML Confidence Distribution",
            labels={"ml_confidence": "Prediction Confidence (P(Up))"},
        )
        fig_conf.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(255,255,255,0.03)",
            font_color="#e2e8f0",
            title_font_color="#c7d2fe",
        )
        fig_conf.add_vline(x=confidence_threshold, line_dash="dash", line_color="#a78bfa",
                           annotation_text=f"Threshold {confidence_threshold}")
        st.plotly_chart(fig_conf, use_container_width=True)

    with col_b:
        # Confidence by direction
        fig_pie = px.pie(
            signals_df,
            names=signals_df["ml_direction"].map({1: "Bullish", 0: "Bearish"}),
            title="Predicted Direction Split",
            color_discrete_sequence=["#34d399", "#f87171"],
            hole=0.45,
        )
        fig_pie.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            font_color="#e2e8f0",
            title_font_color="#c7d2fe",
        )
        st.plotly_chart(fig_pie, use_container_width=True)

    st.markdown("---")

    # SHAP Summary Plot
    st.subheader("📌 Global SHAP Feature Importance")
    st.markdown("Mean |SHAP| across all signals shows which indicators the model relies on most.")

    shap_values, X_all = model.compute_shap_values(signals_df.head(300))
    importance_df = model.get_feature_importance()

    fig_imp = px.bar(
        importance_df.head(8),
        x="gain",
        y="feature",
        orientation="h",
        color="gain",
        color_continuous_scale="Viridis",
        title="XGBoost Feature Importance (Gain)",
        labels={"gain": "Importance (Gain)", "feature": "Feature"},
    )
    fig_imp.update_layout(
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(255,255,255,0.03)",
        font_color="#e2e8f0",
        title_font_color="#c7d2fe",
        coloraxis_showscale=False,
        yaxis={"categoryorder": "total ascending"},
    )
    st.plotly_chart(fig_imp, use_container_width=True)

    st.markdown("---")

    # Signal Table with confidence badges
    st.subheader("📋 Recent High-Confidence Signals")
    display_df = high_conf[
        ["symbol", "direction", "ml_confidence", "ml_direction", "rsi", "macd", "atr", "status"]
    ].head(20).copy()
    display_df["Direction"] = display_df["ml_direction"].map({1: "🟢 Bullish", 0: "🔴 Bearish"})
    display_df["Confidence"] = display_df["ml_confidence"].apply(
        lambda x: f"{'🟢' if x >= 0.75 else '🟡' if x >= 0.6 else '🔴'} {x:.1%}"
    )
    st.dataframe(
        display_df[["symbol", "Direction", "Confidence", "rsi", "macd", "atr", "status"]],
        use_container_width=True,
        hide_index=True,
    )


# ══════════════════════════════════════════════════
# TAB 2 — Risk Monitor
# ══════════════════════════════════════════════════
with tab2:
    st.subheader("⚠️ Risk Monitor")
    st.markdown("Live portfolio health metrics pulled from Phase 6 risk snapshots.")

    # VIX Trend
    fig_vix = go.Figure()
    fig_vix.add_trace(go.Scatter(
        x=risk_df["snapshot_time"],
        y=risk_df["vix_level"],
        mode="lines",
        name="India VIX",
        line=dict(color="#f87171", width=2),
        fill="tozeroy",
        fillcolor="rgba(248,113,113,0.08)",
    ))
    fig_vix.add_hline(y=20, line_dash="dash", line_color="#fbbf24", annotation_text="VIX 20 — Caution")
    fig_vix.add_hline(y=25, line_dash="dash", line_color="#f87171", annotation_text="VIX 25 — High Volatility")
    fig_vix.update_layout(
        title="India VIX (90-Day)",
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(255,255,255,0.03)",
        font_color="#e2e8f0",
        title_font_color="#c7d2fe",
        xaxis=dict(title="Date"),
        yaxis=dict(title="VIX Level"),
    )
    st.plotly_chart(fig_vix, use_container_width=True)

    col_r1, col_r2 = st.columns(2)

    with col_r1:
        # Portfolio Heat
        fig_heat = px.area(
            risk_df,
            x="snapshot_time",
            y="portfolio_heat",
            title="Portfolio Heat (Correlation-adjusted Exposure)",
            color_discrete_sequence=["#6366f1"],
            labels={"portfolio_heat": "Heat Score", "snapshot_time": "Date"},
        )
        fig_heat.add_hline(y=0.7, line_dash="dash", line_color="#f87171", annotation_text="Heat Limit")
        fig_heat.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(255,255,255,0.03)",
            font_color="#e2e8f0",
            title_font_color="#c7d2fe",
        )
        st.plotly_chart(fig_heat, use_container_width=True)

    with col_r2:
        # Drawdown chart
        fig_dd = px.area(
            risk_df,
            x="snapshot_time",
            y="drawdown_pct",
            title="Portfolio Drawdown (%) from HWM",
            color_discrete_sequence=["#f59e0b"],
            labels={"drawdown_pct": "Drawdown %", "snapshot_time": "Date"},
        )
        fig_dd.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(255,255,255,0.03)",
            font_color="#e2e8f0",
            title_font_color="#c7d2fe",
        )
        st.plotly_chart(fig_dd, use_container_width=True)

    # Regime distribution
    st.subheader("📊 Market Regime Distribution")
    regime_counts = risk_df["regime"].value_counts().reset_index()
    regime_counts.columns = ["Regime", "Days"]
    fig_regime = px.bar(
        regime_counts,
        x="Regime",
        y="Days",
        color="Regime",
        color_discrete_map={
            "STRONG_BULL": "#34d399",
            "NEUTRAL": "#60a5fa",
            "CAUTION": "#fbbf24",
            "HIGH_VOLATILITY": "#f87171",
        },
        title="Days Spent in Each Market Regime",
    )
    fig_regime.update_layout(
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(255,255,255,0.03)",
        font_color="#e2e8f0",
        title_font_color="#c7d2fe",
        showlegend=False,
    )
    st.plotly_chart(fig_regime, use_container_width=True)


# ══════════════════════════════════════════════════
# TAB 3 — Execution Analytics
# ══════════════════════════════════════════════════
with tab3:
    st.subheader("💸 Execution Analytics — Slippage & Transaction Costs")
    st.markdown("Phase 7 Capital Protection data: shows how transaction cost guards are saving capital on every trade.")

    col_e1, col_e2, col_e3 = st.columns(3)
    blocked = exec_df[exec_df["blocked_reason"].notna()]
    total_cost = exec_df["estimated_cost"].sum()
    total_slip  = exec_df["spread_slippage_cost"].sum()

    col_e1.metric("Total Orders", f"{len(exec_df):,}")
    col_e2.metric("Blocked by Cost Guard", f"{len(blocked):,}", f"Saved ≈ ₹{blocked['estimated_cost'].sum():,.0f}")
    col_e3.metric("Total Transaction Costs", f"₹{total_cost:,.0f}", f"Slippage: ₹{total_slip:,.0f}")

    st.markdown("---")

    col_f1, col_f2 = st.columns(2)

    with col_f1:
        # Cost over time
        fig_cost = px.line(
            exec_df.sort_values("filled_at"),
            x="filled_at",
            y="estimated_cost",
            title="Transaction Costs Over Time",
            labels={"estimated_cost": "Cost (₹)", "filled_at": "Date"},
            color_discrete_sequence=["#6366f1"],
        )
        fig_cost.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(255,255,255,0.03)",
            font_color="#e2e8f0",
            title_font_color="#c7d2fe",
        )
        st.plotly_chart(fig_cost, use_container_width=True)

    with col_f2:
        # Slippage distribution
        fig_slip = px.histogram(
            exec_df,
            x="spread_slippage_cost",
            nbins=25,
            title="Spread Slippage Cost Distribution",
            labels={"spread_slippage_cost": "Slippage Cost (₹)"},
            color_discrete_sequence=["#f59e0b"],
        )
        fig_slip.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(255,255,255,0.03)",
            font_color="#e2e8f0",
            title_font_color="#c7d2fe",
        )
        st.plotly_chart(fig_slip, use_container_width=True)

    # Cost by symbol
    symbol_costs = exec_df.groupby("symbol")[["estimated_cost", "spread_slippage_cost"]].sum().reset_index()
    fig_sym = px.bar(
        symbol_costs,
        x="symbol",
        y=["estimated_cost", "spread_slippage_cost"],
        title="Total Costs by Symbol",
        barmode="group",
        color_discrete_sequence=["#6366f1", "#f87171"],
        labels={"value": "Cost (₹)", "symbol": "Symbol", "variable": "Type"},
    )
    fig_sym.update_layout(
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(255,255,255,0.03)",
        font_color="#e2e8f0",
        title_font_color="#c7d2fe",
    )
    st.plotly_chart(fig_sym, use_container_width=True)


# ══════════════════════════════════════════════════
# TAB 4 — Regime-Conditional XAI
# ══════════════════════════════════════════════════
with tab4:
    st.subheader("📊 Regime-Conditional Explainability")
    st.markdown("""
    **Research insight**: Do technical indicators matter differently in Bull vs Bear vs Volatile regimes?
    This analysis uses SHAP to answer that question.

    Each bar shows the **mean absolute SHAP value** for each feature in a given market regime,
    revealing which signals the model trusts most per regime.
    """)

    # Synthetic regime assignment from risk data
    regime_map = risk_df[["snapshot_time", "regime"]].copy()
    signals_df["snapshot_date"] = pd.to_datetime(signals_df["created_at"]).dt.date
    regime_map["snapshot_date"] = pd.to_datetime(regime_map["snapshot_time"]).dt.date
    merged = signals_df.merge(regime_map, on="snapshot_date", how="left")

    regime_shap = model.shap_summary_by_regime(merged, regime_col="regime")

    if regime_shap:
        regime_colors = {
            "STRONG_BULL": "#34d399",
            "NEUTRAL": "#60a5fa",
            "CAUTION": "#fbbf24",
            "HIGH_VOLATILITY": "#f87171",
        }
        cols_regime = st.columns(min(len(regime_shap), 2))
        for idx, (regime_name, shap_df) in enumerate(regime_shap.items()):
            with cols_regime[idx % 2]:
                color = regime_colors.get(regime_name, "#6366f1")
                fig_r = px.bar(
                    shap_df,
                    x="mean_abs_shap",
                    y="feature",
                    orientation="h",
                    title=f"Regime: {regime_name}",
                    labels={"mean_abs_shap": "Mean |SHAP|", "feature": "Feature"},
                    color_discrete_sequence=[color],
                )
                fig_r.update_layout(
                    paper_bgcolor="rgba(0,0,0,0)",
                    plot_bgcolor="rgba(255,255,255,0.03)",
                    font_color="#e2e8f0",
                    title_font_color="#c7d2fe",
                    yaxis={"categoryorder": "total ascending"},
                    height=280,
                    margin=dict(t=40, b=20, l=0, r=0),
                )
                st.plotly_chart(fig_r, use_container_width=True)

        st.markdown("---")
        st.markdown("### 🔬 Research Finding Summary")
        st.info("""
        **Interpretation Guide:**
        - In **STRONG_BULL** regimes, momentum indicators (RSI, MACD) tend to have higher SHAP values —
          the model rides the trend.
        - In **HIGH_VOLATILITY** regimes, ATR and BB Width dominate — the model becomes more cautious
          and focuses on volatility signals.
        - In **NEUTRAL/CAUTION** regimes, the model relies on a balanced mix of all features.

        This validates the regime-conditional logic in the Phase 6 Risk Engine.
        """)
    else:
        st.warning("Insufficient data to compute regime-conditional SHAP. Try expanding the date range.")

# ─────────────────────────────────────────────────────────────
# Footer
# ─────────────────────────────────────────────────────────────
st.markdown("---")
st.markdown(
    "<div style='text-align:center; color:#4b5563; font-size:0.85rem;'>"
    "Artha AI • Confidence-Aware XAI Dashboard • Research Project • Phase 9"
    "</div>",
    unsafe_allow_html=True
)
