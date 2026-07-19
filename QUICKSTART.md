# 🚀 Artha AI Copilot 2.0 — Quick Start Guide

## Prerequisites
Make sure you have the following installed on your system:
- **Node.js** (v18 or higher) → https://nodejs.org/
- **npm** (comes with Node.js)
- **Python 3.10+** → https://www.python.org/ (only needed for XAI Dashboard)

---

## Step 1 — Install Dependencies

Run the following commands one by one in your terminal:

```bash
# Install API backend dependencies
cd apps/api
npm install

# Install Web frontend dependencies
cd ../web
npm install
```

---

## Step 2 — Configure Your Environment (Optional for Live Trading)

Create a `.env` file in the root folder with your credentials:

```env
# Database (optional - app runs without this)
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/artha

# Angel One SmartAPI (required for LIVE market data)
SMARTAPI_CLIENT_ID=your_client_id
SMARTAPI_PASSWORD=your_password
SMARTAPI_PIN=your_pin
SMARTAPI_API_KEY=your_app_api_key
SMARTAPI_TOTP_SECRET=your_totp_secret_key
```

> Without credentials the app runs in **mock/demo mode** with simulated data.

---

## Step 3 — Start the Application

**Terminal 1** — Start the API server:
```bash
cd apps/api
npm run dev
```
→ API runs on **http://localhost:4000**

**Terminal 2** — Start the Web frontend:
```bash
cd apps/web
npm run dev
```
→ Frontend runs on **http://localhost:5173**

Open **http://localhost:5173** in your browser.

---

## Step 4 — Optional: Run the XAI Dashboard (Python)

```bash
cd apps/dashboard
pip install -r requirements.txt
streamlit run app.py
```
→ Dashboard opens in your browser automatically.

---

## What's Inside Each Page

| Page | Feature |
|------|---------|
| 📊 **Dashboard** | Live tick streaming, VIX monitor, regime indicator, drawdown tracker |
| 📈 **Watchlist** | Candlestick charts with SMA20/EMA50, volume bars, and timeframe toggles |
| 💼 **Portfolio** | Holdings table, P&L tracking, correlation heat |
| 🤖 **AI Copilot** | Chat with Artha's proactive engine — query drawdowns, positions, rejected signals |
| 🧪 **Backtesting** | Run strategy simulations with win rate, profit factor, and equity growth curves |
| 📰 **News Intel** | Corporate event blackout calendars and sentiment scanner |

---

## Run All Tests
```bash
# Phase 6 Risk Engine (33 tests)
cd packages/phase6-tradingview
npx jest

# Phase 9 Safety Engine (36 tests)
cd packages/phase9-testing
npx jest

# Phase 10 Copilot Engine (104 tests)
cd packages/phase10-copilot-intelligence
npx jest
```

---

## APIs Required for Live Trading

| Service | Cost | Link |
|---------|------|------|
| Angel One SmartAPI | Free | https://smartapi.angelone.in/ |
| PostgreSQL Database | Free (local) | https://postgresql.org/ |

---

Built with ❤️ — Artha AI Copilot 2.0
