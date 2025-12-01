## QuantX — Real-Time Options Analytics Terminal

QuantX is a full-stack options analytics and strategy terminal with a FastAPI backend and a React + Tailwind frontend. It provides probability, volatility, OI, and market regime models, a consensus engine, a strategy engine with live/backtest modes, and a backtest studio with equity curves and stats.

### Tech Stack

- **Backend**: Python 3.11, FastAPI, Motor (MongoDB), NumPy/Pandas/SciPy/arch, Redis, websockets, Uvicorn  
- **Frontend**: React (create-react-app), TailwindCSS, Zustand, React Router, TradingView Lightweight Charts, react-beautiful-dnd  
- **Infra**: MongoDB, Redis, Docker, docker-compose

### Project Structure

- **backend/**
  - `app/main.py` – FastAPI app, CORS, health check, websocket `/ws/signals`
  - `app/api/routes.py` – REST API:
    - `GET /instruments`
    - `GET /chain/live`
    - `GET /chain/history`
    - `POST /probability`
    - `POST /iv`
    - `POST /oi`
    - `POST /skew`
    - `POST /consensus`
    - `POST /strategy/run-live`
    - `POST /strategy/backtest`
    - `POST /strategy/save`
    - `GET /backtest/results/{id}`
    - `GET /models/insights`
  - `services/` – quant models:
    - `probability.py` – Black–Scholes d₂, lognormal ITM, binomial, Monte Carlo, expected move
    - `volatility.py` – IV solver, HV, IV rank/percentile, IV surface, term structure, skew
    - `oi.py` – OI spike detector, volume/OI ratio, multi‑day trend, anomaly score
    - `market.py` – ATR trend, VWAP, Bollinger squeeze, trend, mean reversion, regime
  - `consensus/engine.py` – fuses all model scores into a 0–100 confidence score  
  - `strategies/engine.py` – condition/filter/action/exit evaluation for live runs  
  - `backtest/engine.py` – fee/slippage, equity curve, stats (win rate, PF, DD, Sharpe)  
  - `websocket/live_engine.py` – mock Upstox-like tick engine broadcasting to `/ws/signals`  
  - `models/` – Pydantic schemas and enums for instruments, chains, strategies, backtests  
  - `utils/db.py` – Motor MongoDB client, `get_db()`  
  - `utils/cache.py` – Redis client helper  
  - `config/config.json` – Upstox credentials & WS URL (git-ignored)
- **frontend/**
  - `src/App.js` – Router + shell layout for all pages  
  - `src/components/ShellLayout.js` – left nav + top status bar  
  - `src/state/store.js` – Zustand store (instruments, chains, models, backtests, live signals)  
  - `src/api/client.js` – Axios client wrapping all backend endpoints  
  - `src/api/ws.js` – websocket client for `/ws/signals`  
  - `src/charts/TimeSeriesChart.js` – lightweight-charts wrapper  
  - `src/pages/`:
    - `Dashboard` – overview cards, price chart, live websocket ticks  
    - `LiveOptionChain` – tabular option chain view  
    - `ProbabilityHeatmap` – expected-move & ITM probability tiles vs strike  
    - `OiIvAnalytics` – OI metrics, IV metrics, skew table  
    - `StrategyBuilder` – drag-and-drop blocks (conditions/filters/actions/exits)  
    - `LiveStrategyRunner` – run a sample strategy live via API  
    - `BacktestStudio` – run backtests, show equity curve + stats + trades  
    - `ModelInsights` – descriptions of all model components  
    - `Logs` – websocket tick log  
    - `Trades` – trade list from last backtest

### Configuration

- **Upstox & WS config**: edit `backend/config/config.json`:
  - `upstox_api_key`, `upstox_api_secret`
  - `upstox_redirect_url`
  - `upstox_access_token`, `upstox_feed_token`
  - `ws_url` (Upstox tick stream)  
- **Environment (docker-compose)**:
  - `QUANTX_MONGODB_URI` / `QUANTX_MONGODB_DB`
  - `QUANTX_REDIS_URL`
  - `REACT_APP_API_BASE`, `REACT_APP_WS_URL`

### Running with Docker

From the project root (`QuantX`):

```bash
./run-dev.sh
```

This will:

- Build **backend** (`backend/Dockerfile`) and expose FastAPI on `http://localhost:8000`  
- Build **frontend** (`frontend/Dockerfile`) and expose CRA dev server on `http://localhost:3021`  
- Start **MongoDB** and **Redis** on the shared `quantx-net` bridge network

### Local (non-Docker) Development

- **Backend**:
  ```bash
  cd backend
  python -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
  ```
- **Frontend**:
  ```bash
  cd frontend
  npm install
  npm start
  ```

Ensure MongoDB and Redis are running (for example via Docker: `docker compose up mongodb redis`).

### Key Flows

- **Live data & signals**:
  - `websocket/live_engine.py` produces mock ticks and broadcasts via `SignalManager`  
  - Frontend connects via `src/api/ws.js` and feeds `liveSignals` in the Zustand store  
  - `Dashboard` and `Logs` display ticks; `LiveStrategyRunner` hits the strategy engine
- **Quant models**:
  - REST endpoints proxy into `services/` modules for probability, IV, OI, and market metrics  
  - `consensus/engine.py` combines sub-scores into a single 0–100 confidence score
- **Strategy & backtest**:
  - `StrategyBuilder` exports JSON matching backend `StrategyDefinition` schema  
  - `LiveStrategyRunner` and `BacktestStudio` send these to `/strategy/run-live` and `/strategy/backtest`  
  - Backtests produce an equity curve, stats, and trade list stored in-memory and optionally in MongoDB

You can extend models, strategies, and execution logic without changing the overall wiring: add functions to the appropriate `services/` or `engine` modules and expose them through `app/api/routes.py` as needed.


