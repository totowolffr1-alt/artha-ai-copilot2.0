# Artha AI Copilot — Local Dev Scaffold

This is a working monorepo scaffold that runs a real frontend against a real
API server, backed by your actual Phase 2 (Market Data) source code. It is
**not** a complete implementation of all 10 phases — see "Honest status"
below for exactly what's real vs. stubbed.

## Quick start

```bash
npm install
npm run dev
```

This starts:
- API server → http://localhost:4000
- Frontend → http://localhost:5173

Open http://localhost:5173 in your browser. You should see live (simulated)
ticks updating every second on the Dashboard page.

Run them separately if you prefer:
```bash
npm run dev:api   # http://localhost:4000
npm run dev:web   # http://localhost:5173
```

## Honest status — what's real vs. stub

| Area | Status |
|---|---|
| **Phase 2 — Market Data** | ✅ Real code (`packages/phase2-market-data`), restructured from your files into the nested paths their own imports expect (`src/marketData/...`). Runs via a **Mock adapter** for local dev (see below) — the real `AngelOneAdapter` is present and wired to the same interface, just not connected by default. |
| **Phase 5 — Strategy/Signal Engine** | 📦 Real code copied into `packages/phase5-strategy`, **not yet wired into the API**. The files exist (indicators, regime engine, signal engine, parameter optimiser) but integrating them into a live endpoint is a follow-up step — they're substantial and deserve their own pass rather than a rushed wire-up. |
| **Frontend (`apps/web`)** | ✅ Real, working Vite + React app. Dashboard streams live ticks over Server-Sent Events from the actual EventBus. Watchlist charts candles via Recharts. Portfolio/News/AI Chat pages call real endpoints that return stub data (see below). |
| **API (`apps/api`)** | ✅ Real Express server. Market data routes are real (backed by Phase 2 code + EventBus). Portfolio, Trading, News, AI Chat routes are intentional stubs — they return clearly-labeled mock data since Phases 6–10 have no implementation code in your project, only design docs. |
| **Phase 1, 3, 4, 6, 7, 8, 9, 10** | 📄 Design/audit docs only in your project — no implementation code existed to bring over. Not present in this scaffold beyond route stubs. |

## Why a Mock adapter instead of AngelOneAdapter?

Your `AngelOneAdapter.ts` requires live SmartAPI credentials and hits real
AngelOne endpoints (`apiconnect.angelbroking.com`,
`smartapisocket.angelbroking.com`) — there's no simulated mode built into it.
So a `MockMarketDataAdapter` (`packages/phase2-market-data/src/marketData/adapters/mock/MockAdapter.ts`)
was added, implementing the exact same `IMarketDataAdapter` interface, purely
so the app runs without a broker account. Swap it for `AngelOneAdapter` in
`apps/api/src/server.ts` once you have real credentials in `.env`.

## Known bugs found in the existing Phase 2 source (not introduced by this scaffold)

These were already present in your files and would need fixing before
`AngelOneAdapter` is used for real (currently masked because the API runs
with `ts-node --transpile-only`, which skips type-checking):

- `SmartApiSession.ts` — `login()` returns the raw REST wrapper instead of
  unwrapping `.data` into `SmartApiTokens`
- `AngelOneAdapter.ts` — `fetchRawCandles()` / `searchRawSymbols()` return the
  raw REST response instead of the mapped `RawCandle[]` / `RawSymbol[]`
- `Normalizer.ts` — several methods return an inner field's `Result` (e.g.
  `Result<number>`) instead of `Result<Tick>` / `Result<Candle>`; also
  imports `SMARTAPI_EXCHANGE_TYPE_MAP` / `SMARTAPI_INSTRUMENT_TYPE_MAP` from
  a module that doesn't export them
- `TokenRegistry.ts` — one path returns `Result<void>` where `Result<TokenInfo>`
  is expected

Run `npm run typecheck --workspace=@artha/phase2-market-data` to see the full
list.

Also: `IEventBus` (`EventBus.ts`) was only ever an **interface** in your
project — no concrete class existed. `SimpleEventBus.ts` was added as a
minimal implementation so anything could actually run.

## What a "full" version needs next (in priority order)

1. Fix the Phase 2 bugs above, then wire real AngelOne credentials
2. Wire Phase 5 (strategy/signal engine) into an `/api/signals` endpoint
3. Build Phase 3 (database layer) — currently just a design doc
4. Build Phase 6 (Risk Engine) and Phase 7 (Execution Engine) — design docs only
5. Build Phase 8 (Portfolio Management) — currently stubbed with fake data
6. Build Phase 10 (AI Copilot, News Intelligence) — currently stubbed

## Project layout

```
apps/
  web/     — Vite + React frontend
  api/     — Express API server
packages/
  phase2-market-data/  — your real Phase 2 code, restructured
  phase5-strategy/     — your real Phase 5 code, copied but not wired in yet
docker-compose.yml     — Postgres/TimescaleDB, ready for Phase 3 (not required to run today)
```
