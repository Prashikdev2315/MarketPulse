# Technical Design — AI Market Intelligence Dashboard

> Deep-dive reference for error handling, retry logic, architecture decisions, and engineering challenges.
> The [README](../README.md) covers setup, features, and usage.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Error Handling & Resilience](#error-handling--resilience)
   - [Typed Error System](#typed-error-system-libapits)
   - [Retry Strategy](#retry-strategy)
   - [Per-Component Error States](#per-component-error-states)
3. [Challenges & Solutions](#challenges--solutions)

---

## Architecture

```
 ┌─────────────────────────────────────┐
 │          Next.js Frontend           │
 │  page.tsx  ──►  lib/api.ts          │
 │                 - Typed ApiError    │
 │                 - fetch + retry     │
 │                 - 15 s AI timeout   │
 │                 - localStorage cache│
 └──────────────┬──────────────────────┘
                │ HTTP  /api/*  (Next.js rewrites)
                ▼
┌─────────────────────────────────────┐
│      FastAPI Backend  :8000         │
│                                     │
│  /market  ──► yahoo_finance.py      │
│               (ThreadPoolExecutor,  │
│                TTL cache, retry)    │
│                                     │
│  /news    ──► news_aggregator.py    │
│               (parallel RSS, NLP    │
│                scoring, sentiment)  │
│                                     │
│  /ai      ──► ai_analyzer.py        │
│               (Gemini REST, prompt  │
│                engineering, JSON    │
│                parsing, fallback)   │
│                                     │
│  /stocks  ──► stock_service.py      │
│               (search, quote, info, │
│                stock-specific news) │
└─────────────────────────────────────┘
               │
               ▼
       External Data Sources
   Yahoo Finance · RSS Feeds · Gemini API
```

**Key design decisions:**
- Next.js `rewrites` in `next.config.js` proxy `/api/*` to the FastAPI origin — no CORS headers needed in production and no API URL leaks to the client.
- The backend cache uses a single in-process dict with TTL (60 s for quotes, 300 s for history, 600 s for news) and exposes a `get_stale()` method so degraded responses are returned rather than 500s.
- Gemini prompts enforce strict JSON schema output with a `_strip_code_fence` + `json.loads` pipeline; a `generate_fallback_insight()` rule engine runs when the API key is absent.

---

## Error Handling & Resilience

The dashboard is built with a layered, typed error strategy so users always get a clear, actionable message instead of a blank screen or silent crash.

### Typed Error System (`lib/api.ts`)

| Error Kind | When it fires | User message |
|---|---|---|
| `network` | `fetch()` threw (offline, DNS failure, server unreachable) | "Connection issue — check your network or make sure the backend is running." |
| `not_found` | Backend returned 404 — ticker / resource doesn't exist | "\"TICKER\" was not found. It may be delisted or the ticker may be wrong." |
| `server` | Backend returned 5xx | "Server error — the backend returned an unexpected response." |
| `timeout` | AbortController fired before a response arrived (15 s for AI calls) | "AI analysis timed out (15 s). The model may be busy — please try again." |
| `empty` | Fetch succeeded but payload was empty / malformed JSON | "Received an empty or malformed response. Please try again." |
| `api` | Any other 4xx (bad request, unauthorised, etc.) | Specific message from the server |

### Retry Strategy

- **Background fetches** (indices, history, news, heatmap): up to **2 automatic retries** with exponential back-off (1 s base, doubles each attempt, ±20 % jitter). Only 5xx and network failures are retried; 4xx responses are permanent.
- **AI analysis** (`analyzeMarket`, `analyzeStock`): **no automatic retries** — the user explicitly clicks "Retry Analysis". The UI enforces a **max of 3 user-initiated attempts** before the button is disabled with an explanatory message.
- **Stock search**: 1 automatic background retry, then a "Retry (N left)" button for up to 3 user-initiated retries.

### Per-Component Error States

#### Stock Search Box
- **No results**: shows "No results found for '\<ticker\>'" with a suggestion to try the full name or exchange suffix (e.g. `RELIANCE.NS`).
- **Network error**: red `WifiOff` icon + "Connection issue" message + retry button.
- **API / server error**: amber `AlertCircle` icon + server message + retry button.
- **Input border**: turns red when an error is present, returns to normal on success.

#### Stock Detail Modal
- **404 / not found**: yellow `SearchX` icon, "Ticker Not Found" title — **no retry button** (the ticker is wrong, retrying won't help).
- **Network / connection error**: red `WifiOff` icon + retry button.
- **Empty / malformed response**: generic error with retry button.

#### AI Insight Panel
- **15-second hard timeout**: any AI request is cancelled after 15 s via `AbortController`, replacing the infinite spinner.
- **Timeout**: amber `Clock` icon + "AI Analysis Timed Out" heading.
- **Network failure**: red `WifiOff` icon + "Connection Issue" heading.
- **AI unavailable**: red `AlertTriangle` + "AI Analysis Unavailable" heading.
- **Retry limit**: after 3 user-initiated retries the button is replaced by "Max retries reached — check the backend server and refresh the page."

---

## Challenges & Solutions

| Challenge | Solution |
|---|---|
| **yfinance ≥ 1.0 breaking custom sessions** | Removed all `requests.Session` injection; let the library manage its own `curl_cffi` session internally |
| **Leaflet crashing in Next.js SSR** | Deferred map init to `requestAnimationFrame` so the container div has real pixel dimensions before Leaflet touches the DOM |
| **Gemini returning markdown-wrapped JSON** | Wrote `_strip_code_fence()` — correctly handles both opening and trailing fences that the previous naïve slice approach missed |
| **GeoJSON click handlers holding stale closures** | Module-level `_latestOnCountrySelect` ref updated on every render; handlers always call the current callback, not the mount-time one |
| **RSS feeds returning non-financial noise** | Layered keyword scoring: high-weight (score +3), medium-weight (score +1), ticker regex bonus (+5), with a hard reject list for sports/celebrity/weather content |
| **Market status across five timezones + holidays** | `_TZ_MAP` maps country codes to `pytz` timezone + open/close minutes; holiday calendar encoded as `MM-DD` sets per country |
| **Parallel quote fetching without hammering Yahoo** | `ThreadPoolExecutor(max_workers=5)` across all index symbols; results re-sorted to preserve original symbol order |
| **Invalid ticker showing blank screen / crash** | `fetchStockQuote` maps 404 → `ApiError('not_found')` so the modal renders "Ticker Not Found" instead of crashing |
| **AI spinner running forever on slow/hung Gemini** | Both `analyzeStock` and `analyzeMarket` use a 15 s `AbortController` timeout; spinner is replaced by a typed "timed out" error state |
| **Network vs not-found confusion** | All fetch helpers classify errors into `ApiErrorKind` (`network`, `not_found`, `server`, `timeout`, `empty`, `api`) and each UI component renders a distinct icon + message per kind |
| **Malformed / empty JSON response crashing render** | `safeParse()` in `api.ts` returns `null` on bad JSON; callers throw `ApiError('empty')` and components render a graceful fallback instead of throwing |
