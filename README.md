# AI Market Intelligence Dashboard

![Tests](https://github.com/Prashikdev2315/MarketPulse/actions/workflows/backend-tests.yml/badge.svg)

> A full-stack, AI-powered financial market platform that tracks global indices, aggregates real-time financial news, and delivers Gemini-generated institutional-grade market analysis — all in a single dark-mode dashboard.

---

## Problem Statement

I'm a swing trader who watches both Indian and global markets — because what happens overnight in the US or Japan directly moves NIFTY by morning. Keeping tabs on five different country markets meant five browser tabs, five refresh cycles, and completely disconnected context. When I wanted to understand *why* a position moved, I'd have to manually copy the day's price data into ChatGPT and paste in news headlines separately — just to get a basic take that any halfway-decent analyst could give in ten seconds. The timezone juggling made it worse: by the time I'd aggregated everything, the London session was already moving. I built this so a single dashboard could show me live indices, the news that drove them, and an AI analysis that already has that context baked in — no copy-paste, no tab-switching.

---

## Features

- **Global Market Overview** — Live quotes for 13+ indices across India 🇮🇳, US 🇺🇸, UK 🇬🇧, Japan 🇯🇵, and China 🇨🇳 with open/high/low/volume, trend direction, and market-session status (Open / Pre-Market / Holiday / Weekend)
- **Interactive World Map** — Leaflet-powered dark globe; click a country to fly in and load that market's dashboard
- **OHLCV Candlestick Charts** — Time-range selector (1D · 1W · 1M · 6M · 1Y · MAX) with intraday and daily resolution
- **Sector Heatmap** — Sector-grouped stock grid colored by % change, sortable by volatility
- **Individual Stock Lookup** — Search any ticker; get quote, fundamentals (P/E, beta, 52W range, market cap), and stock-specific news
- **AI Market Analysis** — Gemini 2.0 Flash generates structured analyst reports: market summary, sector momentum, macro factors, risk alerts, and opportunities; supports `today`, `5days`, `1month`, `why`, `forecast` modes
- **Next-Day Stock Prediction** — Directional call (up/down/sideways) with estimated % move range, price targets, and key support/resistance levels
- **Financial News Feed** — Parallel RSS ingestion from 11 sources (ET, Mint, Business Standard, Reuters, CNBC, BBC, Nikkei…); keyword-scored for financial relevance, auto-classified by category and sector, sentiment-labeled (Bullish / Bearish / Neutral)
- **Stale-Cache Resilience** — Both backend (TTL cache) and frontend (localStorage) fall back to last-known-good data during outages; stale data is flagged in the UI
- **Rule-Based Fallback Analysis** — Runs without a Gemini API key; generates a heuristic insight from index moves and news sentiment counts

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 14 (App Router), React 18, TypeScript |
| **Styling** | Tailwind CSS v3, Framer Motion (animations) |
| **Maps** | Leaflet + react-leaflet, CartoDB dark tiles |
| **State** | React `useState` / `useRef` / `useCallback` (local state) |
| **Backend** | FastAPI, Python 3.11+, Uvicorn |
| **Market Data** | yfinance ≥ 0.2.61 (Yahoo Finance wrapper) |
| **News** | feedparser — parallel RSS ingestion |
| **AI** | Google Gemini 2.0 Flash (via REST, httpx) |
| **Caching** | In-process TTL cache (custom `utils/cache.py`) |
| **HTTP** | httpx (backend → Gemini), fetch with retry (frontend) |

---

## Installation

### Prerequisites

- Python 3.11+
- Node.js 18+
- A [Google AI Studio](https://aistudio.google.com/) API key (optional — fallback analysis runs without it)

### 1. Clone

```bash
git clone https://github.com/<your-username>/trading.git
cd trading
```

### 2. Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt

cp .env.example .env
# Edit .env — only GEMINI_API_KEY is required (optional; fallback analysis runs without it)
```

`.env.example` contains:

```
GEMINI_API_KEY=your_gemini_api_key_here
ENVIRONMENT=development
```

Start the API server:

```bash
uvicorn main:app --reload --port 8000
```

Verify: `http://localhost:8000/health`

### 3. Frontend

```bash
cd ../frontend
npm install
npm run dev
```

Open: `http://localhost:3000`

---

## Usage Examples

### Explore a country's market
1. Click any highlighted country on the world map (India, US, UK, Japan, China).
2. The dashboard loads live indices, news, and a pre-computed AI summary for that market.

### Analyze a stock
1. Use the **Stock Search** bar — type a ticker or company name (e.g. `RELIANCE`, `AAPL`).
2. View quote, fundamentals, and stock-specific news.
3. Hit **AI Analyze** → select `Next Day Prediction` for a directional call with price targets.

### Ask the AI a custom question
- In the AI Insight panel, select the **"Why?"** tab and type a free-form question (e.g. *"Why did NIFTY fall today?"*).
- The model receives live index data + today's top news as context before responding.

### REST API (FastAPI docs)

```
GET  /market/indices?country=IN        # all Indian indices
GET  /market/history/^NSEI?period=1M   # NIFTY 50 candlesticks
GET  /market/heatmap?country=US        # S&P sector heatmap
GET  /news/?country=IN&limit=20        # top 20 scored news articles
POST /ai/analyze  {"period":"today","country":"IN"}
POST /stocks/analyze {"symbol":"RELIANCE.NS","period":"nextday"}
```

Interactive docs: `http://localhost:8000/docs`

---

## Testing

The backend has a pytest suite covering five areas:

| File | What it tests |
|---|---|
| `tests/test_cache.py` | TTL cache: get/set, expiry, stale reads, eviction, thread safety |
| `tests/test_ai_parser.py` | Gemini JSON parser: code-fence stripping, fallback generation, section icon sanitisation |
| `tests/test_market_status.py` | Market open/closed logic across all five timezones + holiday calendars |
| `tests/test_news_scoring.py` | News NLP: keyword scoring, reject-list filtering, sentiment, category, sector detection |
| `tests/test_routers.py` | HTTP integration: `GET /market/indices`, `GET /stocks/quote/{symbol}`, `GET /news/` — all external calls mocked |

All 136 tests run fully offline (no API keys or internet required):

```bash
cd backend
python -m pytest -v
```

---

## Design & Engineering Notes

For details on error handling strategy, retry logic, architecture diagram, and the challenges solved during development, see [docs/DESIGN.md](./docs/DESIGN.md).

---

## Future Improvements

- [ ] **WebSocket push** — replace polling with server-sent events for live price ticks
- [ ] **Portfolio tracker** — let users add holdings and see P&L overlaid on the dashboard
- [ ] **Persistent cache** — swap the in-process dict for Redis to survive restarts and scale horizontally
- [ ] **Historical AI log** — store Gemini responses in SQLite so users can review past predictions
- [ ] **TradingView Advanced Charts widget** — deeper technical analysis (RSI, MACD, Bollinger Bands)
- [ ] **More markets** — Germany (DAX), France (CAC 40), Australia (ASX 200), Brazil (Bovespa)
- [ ] **Alert system** — email / push notification when an index crosses a user-defined threshold
- [ ] **Auth + multi-user** — JWT-based auth so each user can save watchlists and preferences

---

## License

MIT © 2026 — see [LICENSE](./LICENSE) for the full text.
