"""Stock (individual equity) data service.

Lives alongside ``yahoo_finance.py`` (which is index-only by design) so the
existing dashboard and its hardcoded ``INDICES`` dict are left untouched. All
functions here work for *arbitrary* stock symbols (e.g. ``RELIANCE.NS``,
``AAPL``, ``TSLA``).

Sources (all free, no API key, all already installed dependencies):
  - Yahoo Search API  → symbol lookup      (httpx)
  - yfinance          → quote + fundamentals (ticker.history / .info / .fast_info)
  - Google News RSS   → company news        (feedparser)

Every function uses the shared ``cache`` singleton and follows the TTL
conventions established elsewhere in the codebase:
  search=120s, quote/info=60s, news=600s, trending=120s.
"""
import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus

import feedparser
import httpx

from utils.cache import cache
from services.news_aggregator import (
    clean_html,
    parse_date,
    _detect_sentiment,
    _classify_category,
    _detect_sectors,
    _estimate_impact,
    _financial_score,
)

logger = logging.getLogger(__name__)

# ── Yahoo public search endpoint ─────────────────────────────────────────────
_YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"

# Per-country exchange suffix → (country code, TradingView prefix) for client-side
# symbol resolution. Order matters: longer suffixes are matched first.
_SUFFIX_MAP: List[Tuple[str, str, str]] = [
    # (yahoo_suffix, country_code, tradingview_prefix)
    (".NS",  "IN", "NSE"),
    (".BO",  "IN", "BSE"),
    (".L",   "GB", "LSE"),
    (".T",   "JP", "TSE"),
    (".HK",  "CN", "HKEX"),
    (".SH",  "CN", "SSE"),
    (".SZ",  "CN", "SSE"),
]
# US tickers known to trade on NASDAQ; everything else plain (no suffix) is
# assumed NYSE. Best-effort — TradingView also resolves bare tickers itself.
_NASDAQ_TICKERS = {
    "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "GOOG", "META", "NFLX",
    "AMD", "INTC", "CSCO", "ADBE", "PEP", "COST", "AVGO", "TXN", "QCOM",
    "TMUS", "CMCSA", "NVAX", "BIIB", "GILD", "ISRG", "VRTX", "REGN",
}

# Curated trending / popular tickers per country. Hand-picked for liquidity and
# name recognition so the "trending" endpoint never depends on a paid API.
TRENDING_STOCKS: Dict[str, List[Tuple[str, str]]] = {
    "IN": [
        ("Reliance",      "RELIANCE.NS"),
        ("TCS",           "TCS.NS"),
        ("Infosys",       "INFY.NS"),
        ("HDFC Bank",     "HDFCBANK.NS"),
        ("ICICI Bank",    "ICICIBANK.NS"),
        ("Bajaj Auto",    "BAJAJ-AUTO.NS"),
        ("SBI",           "SBIN.NS"),
        ("Bharti Airtel", "BHARTIARTL.NS"),
    ],
    "US": [
        ("Apple",      "AAPL"),
        ("Microsoft",  "MSFT"),
        ("NVIDIA",     "NVDA"),
        ("Tesla",      "TSLA"),
        ("Amazon",     "AMZN"),
        ("Google",     "GOOGL"),
        ("Meta",       "META"),
        ("JPMorgan",   "JPM"),
    ],
    "GB": [
        ("Shell",           "SHEL.L"),
        ("HSBC",            "HSBA.L"),
        ("BP",              "BP.L"),
        ("AstraZeneca",     "AZN.L"),
        ("Unilever",        "ULVR.L"),
        ("GSK",             "GSK.L"),
    ],
    "JP": [
        ("Toyota",   "7203.T"),
        ("Sony",     "6758.T"),
        ("Nintendo", "7974.T"),
        ("SoftBank", "9984.T"),
        ("Mitsubishi", "8058.T"),
        ("Keyence",  "6861.T"),
    ],
    "CN": [
        ("Tencent",  "0700.HK"),
        ("Alibaba",  "9988.HK"),
        ("Meituan",  "3690.HK"),
        ("JD.com",   "9618.HK"),
        ("BYD",      "1211.HK"),
        ("ICBC",     "1398.HK"),
    ],
}

# yfinance returns ``marketCap`` etc. only when available; these are the keys we
# read off ``ticker.info``. Missing keys are skipped gracefully.
_INFO_KEYS = [
    "longName", "shortName", "currency", "exchange", "symbol",
    "sector", "industry", "marketCap", "trailingPE", "forwardPE",
    "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "beta",
    "averageVolume", "trailingAnnualDividendYield",
    "marketState", "quoteType",
]


def _suffix_for_symbol(symbol: str) -> Optional[Tuple[str, str]]:
    """Return (country_code, tradingview_prefix) for a Yahoo symbol, or None."""
    up = symbol.upper()
    for suffix, country, tv_prefix in _SUFFIX_MAP:
        if up.endswith(suffix):
            return country, tv_prefix
    return None


def to_tradingview_symbol(symbol: str) -> str:
    """Map a Yahoo stock symbol to a TradingView symbol.

    Indian stocks (.NS / .BO) → NSE:<bare> — TradingView free widget resolves
    NSE stocks without requiring a Pro subscription.
    Bare US tickers → NASDAQ: or NYSE: based on a small allowlist.
    """
    up = symbol.upper()

    # Indian stocks — both NSE and BSE listings map to NSE: prefix on TradingView
    if up.endswith('.NS') or up.endswith('.BO'):
        bare = up.split('.')[0]
        return f"NSE:{bare}"

    # Other exchange suffixes
    suffix_map = {
        '.L':  'LSE',
        '.T':  'TSE',
        '.HK': 'HKEX',
        '.SH': 'SSE',
        '.SZ': 'SSE',
    }
    for suffix, prefix in suffix_map.items():
        if up.endswith(suffix):
            return f"{prefix}:{up.split('.')[0]}"

    # No known suffix → treat as US
    bare = up
    return f"NASDAQ:{bare}" if bare in _NASDAQ_TICKERS else f"NYSE:{bare}"


def _country_for_symbol(symbol: str) -> str:
    mapping = _suffix_for_symbol(symbol)
    return mapping[0] if mapping else "US"


# ── Search ───────────────────────────────────────────────────────────────────
def search_stocks(query: str, country: Optional[str] = None) -> List[Dict[str, Any]]:
    """Search Yahoo for equities matching ``query``.

    ``country`` (e.g. 'IN', 'US') optionally restricts results to that country's
    exchange suffixes. Returns up to 10 results with a pre-computed
    ``tradingViewSymbol`` so the frontend needs no client-side guessing.

    Network failures are non-fatal — an empty list is returned and logged.
    """
    query = (query or "").strip()
    if len(query) < 1:
        return []

    cache_key = f"stocksearch_{query.lower()}_{country or 'all'}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    params = {
        "q": query,
        "quotesCount": 15,
        "newsCount": 0,
        "enableFuzzyQuote": "false",
        "quotesQueryId": "tss_match_phrase_query",
    }
    headers = {"User-Agent": "Mozilla/5.0 (market-intelligence-backend)"}

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(_YAHOO_SEARCH_URL, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Yahoo search failed for '%s': %s", query, exc)
        return []

    results: List[Dict[str, Any]] = []
    for q in data.get("quotes", []) or []:
        # Keep only equities (skip ETFs, indices, futures, mutual funds).
        qtype = (q.get("quoteType") or "").upper()
        if qtype not in ("EQUITY", "ON", "CS"):
            continue
        symbol = q.get("symbol") or ""
        if not symbol:
            continue
        # Yahoo sometimes returns index symbols (^NSEI etc.) here too; skip.
        if symbol.startswith("^"):
            continue

        sym_country = _country_for_symbol(symbol)
        if country and country.upper() != sym_country and country.upper() != "ALL":
            # Allow the caller's country to mismatch only when the symbol has no
            # known suffix (bare US tickers) AND the caller asked for US.
            if not (country.upper() == "US" and _suffix_for_symbol(symbol) is None):
                continue

        name = q.get("longname") or q.get("shortname") or q.get("longName") or symbol
        exchange = q.get("exchange") or ""
        results.append({
            "symbol":            symbol,
            "name":              name,
            "exchange":          exchange,
            "type":              "EQUITY",
            "country":           sym_country,
            "tradingViewSymbol": to_tradingview_symbol(symbol),
        })
        if len(results) >= 10:
            break

    cache.set(cache_key, results, ttl=120)
    return results


# ── Fundamentals ─────────────────────────────────────────────────────────────
def get_stock_info(symbol: str) -> Optional[Dict[str, Any]]:
    """Return company fundamentals for a stock via yfinance.

    Uses ``ticker.info`` (and ``fast_info`` for a couple of hot fields). The
    existing index-only ``fetch_quote`` cannot do this — it resolves metadata
    solely from the hardcoded ``INDICES`` dict, so it returns broken records
    for arbitrary stocks. This function is that gap's fix.

    Returns ``None`` on failure.
    """
    cache_key = f"stockinfo_{symbol}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    try:
        import yfinance as yf  # imported lazily to keep module import cheap
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        fast = {}
        try:
            fast = {
                k: getattr(ticker.fast_info, k)
                for k in ("currency", "last_price", "market_cap", "previous_close")
                if hasattr(ticker.fast_info, k)
            }
        except Exception:
            pass  # fast_info is optional; .info already has most fields

        result: Dict[str, Any] = {
            "symbol":   symbol,
            "name":     info.get("longName") or info.get("shortName") or symbol,
            "currency": info.get("currency") or fast.get("currency") or "USD",
            "exchange": info.get("exchange") or "",
            "sector":   info.get("sector") or "",
            "industry": info.get("industry") or "",
            "market_cap":        info.get("marketCap"),
            "trailing_pe":       info.get("trailingPE"),
            "forward_pe":        info.get("forwardPE"),
            "beta":              info.get("beta"),
            "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
            "fifty_two_week_low":  info.get("fiftyTwoWeekLow"),
            "average_volume":    info.get("averageVolume"),
            "dividend_yield":    info.get("trailingAnnualDividendYield"),
            "market_state":      info.get("marketState") or "REGULAR",
            "quote_type":        info.get("quoteType") or "EQUITY",
            "tradingViewSymbol": to_tradingview_symbol(symbol),
            "country":           _country_for_symbol(symbol),
        }
        cache.set(cache_key, result, ttl=60)
        return result
    except Exception as exc:
        logger.error("get_stock_info failed for %s: %s", symbol, exc)
        stale, _ = cache.get_stale(cache_key)
        return stale


# ── Quote (IndexQuote-compatible shape) ──────────────────────────────────────
def _calculate_trend(change_pct: float) -> str:
    if change_pct > 0.5:
        return "bullish"
    if change_pct < -0.5:
        return "bearish"
    return "neutral"


def get_stock_quote(symbol: str) -> Optional[Dict[str, Any]]:
    """Return a single-stock quote shaped exactly like the index ``fetch_quote``
    output, so the frontend's ``IndexQuote`` type and ``IndexCard`` component
    can be reused without modification.
    """
    cache_key = f"stockquote_{symbol}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="5d", interval="1d", timeout=15)
        hist = hist.dropna(subset=["Close"])
        if hist.empty or len(hist) < 1:
            return None
        latest = hist.iloc[-1]
        prev = hist.iloc[-2] if len(hist) >= 2 else hist.iloc[-1]
        price = float(latest["Close"])
        prev_close = float(prev["Close"])
        change = price - prev_close
        change_pct = (change / prev_close) * 100 if prev_close else 0.0

        info = get_stock_info(symbol) or {}
        country = info.get("country", "US")

        # Cheap market-status heuristic per country (reuses index helper).
        try:
            from services.yahoo_finance import get_market_status
            market_status = get_market_status(country)
        except Exception:
            market_status = {"session": info.get("market_state", "REGULAR"),
                             "is_open": False}

        result = {
            "symbol":         symbol,
            "name":           info.get("name", symbol),
            "price":          round(price, 2),
            "change":         round(change, 2),
            "change_pct":     round(change_pct, 2),
            "open":           round(float(latest.get("Open", price)), 2),
            "high":           round(float(latest.get("High", price)), 2),
            "low":            round(float(latest.get("Low", price)), 2),
            "volume":         int(latest.get("Volume", 0) or 0),
            "currency":       info.get("currency", "USD"),
            "country":        country,
            "market_status":  market_status["session"],
            "is_market_open": market_status["is_open"],
            "trend":          _calculate_trend(change_pct),
            "timestamp":      datetime.now(timezone.utc).isoformat(),
            "is_stale":       False,
        }
        cache.set(cache_key, result, ttl=60)
        return result
    except Exception as exc:
        logger.error("get_stock_quote failed for %s: %s", symbol, exc)
        stale, _ = cache.get_stale(cache_key)
        if stale:
            stale["is_stale"] = True
            return stale
        return None


# ── Trending ─────────────────────────────────────────────────────────────────
def get_trending(country: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return quotes for a curated list of popular tickers for a country.

    Fetches all quotes in parallel via the batch helper, then enriches each
    with ``tradingViewSymbol`` + sector for richer chips. Falls back to US when
    the country is unknown.
    """
    code = (country or "US").upper()
    names_symbols = TRENDING_STOCKS.get(code) or TRENDING_STOCKS["US"]

    cache_key = f"trending_{code}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    symbols = [sym for _, sym in names_symbols]
    name_by_sym = {sym: name for name, sym in names_symbols}

    def _one(sym: str) -> Optional[Dict[str, Any]]:
        quote = get_stock_quote(sym)
        if not quote:
            return None
        return {
            "symbol":            sym,
            "name":              quote.get("name") or name_by_sym.get(sym, sym),
            "price":             quote.get("price"),
            "change_pct":        quote.get("change_pct"),
            "currency":          quote.get("currency"),
            "is_market_open":    quote.get("is_market_open"),
            "tradingViewSymbol": to_tradingview_symbol(sym),
        }

    results: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(_one, s): s for s in symbols}
        for fut in as_completed(futures):
            try:
                r = fut.result()
                if r:
                    results.append(r)
            except Exception as exc:
                logger.warning("trending fetch failed for %s: %s", futures[fut], exc)

    # Preserve curated order
    order = {sym: i for i, (_, sym) in enumerate(names_symbols)}
    results.sort(key=lambda x: order.get(x["symbol"], 999))
    cache.set(cache_key, results, ttl=120)
    return results


def _extract_source(url: str) -> str:
    """Best-effort domain → outlet name from a URL."""
    try:
        from urllib.parse import urlparse
        host = urlparse(url).netloc.lower()
        host = host.replace("www.", "")
        return host.split(":")[0] or "Google News"
    except Exception:
        return "Google News"


# ── Company news ─────────────────────────────────────────────────────────────
def fetch_stock_news(symbol: str, company_name: str, limit: int = 15) -> List[Dict[str, Any]]:
    """Company-specific news via Google News RSS (same pattern the existing
    Reuters feed at ``news_aggregator.py:22`` uses).

    Articles are post-processed with the same sentiment/category/sector helpers
    as the market news feed, so the frontend's ``NewsArticle`` type renders
    them unchanged.
    """
    cache_key = f"stocknews_{symbol}_{limit}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    # Build a focused query: company name (or symbol if no name) + finance terms.
    term = company_name or symbol
    query = quote_plus(f"{term} stock OR earnings")
    rss_url = f"https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"

    out: List[Dict[str, Any]] = []
    seen: set = set()
    try:
        feed = feedparser.parse(rss_url)
        for entry in feed.entries[:40]:
            url = getattr(entry, "link", "")
            if not url or url in seen:
                continue
            seen.add(url)
            title = getattr(entry, "title", "No title")
            summary = clean_html(getattr(entry, "summary", getattr(entry, "description", "")))
            combined = f"{title} {summary}"

            score = _financial_score(combined)
            sentiment = _detect_sentiment(combined)
            out.append({
                "id":               hashlib.md5(url.encode()).hexdigest()[:12],
                "title":            title,
                "summary":          summary or title,
                "source":           (getattr(entry, "source", None) and entry.source.title)
                                    or _extract_source(url),
                "url":              url,
                "published_at":     parse_date(entry),
                "sentiment":        sentiment["sentiment"],
                "sentiment_label":  sentiment["sentiment_label"],
                "category":         _classify_category(combined),
                "affected_sectors": _detect_sectors(combined),
                "market_impact":    _estimate_impact(score, combined),
                "relevance_score":  score,
            })
            if len(out) >= limit:
                break
    except Exception as exc:
        logger.warning("stock news fetch failed for %s: %s", symbol, exc)

    out.sort(key=lambda a: a["published_at"], reverse=True)
    cache.set(cache_key, out, ttl=600)
    return out

