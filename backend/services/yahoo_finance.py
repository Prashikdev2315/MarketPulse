"""Yahoo Finance service — wraps yfinance for market data.

yfinance >= 1.0 handles its own curl_cffi session internally; do NOT pass a
custom requests.Session (it raises YFDataException in newer versions).
"""
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import List, Optional

import pytz
import yfinance as yf

from utils.cache import cache

logger = logging.getLogger(__name__)

# ── Index configurations ──────────────────────────────────────────────────────
INDICES = {
    # India
    "^NSEI":     {"name": "NIFTY 50",            "country": "IN", "currency": "INR"},
    "^BSESN":    {"name": "SENSEX",              "country": "IN", "currency": "INR"},
    "^NSEBANK":  {"name": "BANK NIFTY",          "country": "IN", "currency": "INR"},
    "^CNXIT":    {"name": "NIFTY IT",            "country": "IN", "currency": "INR"},
    # US
    "^GSPC":     {"name": "S&P 500",             "country": "US", "currency": "USD"},
    "^IXIC":     {"name": "NASDAQ",              "country": "US", "currency": "USD"},
    "^DJI":      {"name": "Dow Jones",           "country": "US", "currency": "USD"},
    # UK
    "^FTSE":     {"name": "FTSE 100",            "country": "GB", "currency": "GBP"},
    "^FTMC":     {"name": "FTSE 250",            "country": "GB", "currency": "GBP"},
    # Japan
    "^N225":     {"name": "Nikkei 225",          "country": "JP", "currency": "JPY"},
    "^TOPX":     {"name": "TOPIX",               "country": "JP", "currency": "JPY"},
    # China
    "000001.SS": {"name": "Shanghai Composite",  "country": "CN", "currency": "CNY"},
    "000300.SS": {"name": "CSI 300",             "country": "CN", "currency": "CNY"},
}

COUNTRY_INDICES = {
    "IN": ["^NSEI", "^BSESN", "^NSEBANK", "^CNXIT"],
    "US": ["^GSPC", "^IXIC", "^DJI"],
    "GB": ["^FTSE", "^FTMC"],
    "JP": ["^N225", "^TOPX"],
    "CN": ["000001.SS", "000300.SS"],
}

# ── Market hours (local timezone open/close in minutes-of-day) ────────────────
_TZ_MAP = {
    "IN": ("Asia/Kolkata",      9 * 60 + 15, 15 * 60 + 30),
    "US": ("America/New_York",  9 * 60 + 30, 16 * 60),
    "GB": ("Europe/London",     8 * 60,      16 * 60 + 30),
    "JP": ("Asia/Tokyo",        9 * 60,      15 * 60 + 30),
    "CN": ("Asia/Shanghai",     9 * 60 + 30, 15 * 60),
}

# ── Public holidays (MM-DD) per country ───────────────────────────────────────
_HOLIDAYS: dict = {
    "IN": {
        "01-26", "08-15", "10-02",   # Republic Day, Independence Day, Gandhi Jayanti
        "03-25", "03-26",             # Holi (approx)
        "04-14", "04-18",             # Ambedkar Jayanti, Good Friday
        "11-01",                      # Diwali (approx)
        "12-25",                      # Christmas
    },
    "US": {"01-01", "07-04", "11-11", "12-25"},
    "GB": {
        "01-01", "04-18", "04-21",
        "05-05", "05-26", "08-25",
        "12-25", "12-26",
    },
    "JP": {
        "01-01", "01-13", "02-11",
        "03-20", "04-29", "05-03",
        "05-04", "05-05", "07-21",
        "09-15", "09-23", "10-13",
        "11-03", "11-23", "12-23",
    },
    "CN": {"01-01", "10-01", "10-02", "10-03", "10-07"},
}


def _retry(func, retries: int = 3, delay: float = 1.0):
    """Retry wrapper with exponential back-off."""
    last_exc: Optional[Exception] = None
    for attempt in range(retries):
        try:
            return func()
        except Exception as exc:
            last_exc = exc
            if attempt < retries - 1:
                logger.warning(
                    "yfinance retry attempt=%d/%d exc=%s — backing off %.1fs",
                    attempt + 1, retries, exc, delay * (2 ** attempt),
                )
                time.sleep(delay * (2 ** attempt))
    raise last_exc  # type: ignore[misc]


def get_market_status(country: str) -> dict:
    """Return open/closed status with weekend and holiday awareness."""
    try:
        tz_name, open_min, close_min = _TZ_MAP.get(country, ("UTC", 0, 24 * 60))
        tz = pytz.timezone(tz_name)
        now = datetime.now(tz)

        if now.weekday() >= 5:
            return {"is_open": False, "session": "Weekend", "timezone": tz_name}

        date_str = now.strftime("%m-%d")
        if date_str in _HOLIDAYS.get(country, set()):
            return {"is_open": False, "session": "Holiday", "timezone": tz_name}

        current_min = now.hour * 60 + now.minute
        is_open = open_min <= current_min <= close_min
        session = "Open" if is_open else ("Pre-Market" if current_min < open_min else "Closed")
        return {"is_open": is_open, "session": session, "timezone": tz_name}
    except Exception:
        return {"is_open": False, "session": "Unknown", "timezone": "UTC"}


def _calculate_trend(change_pct: float) -> str:
    if change_pct > 0.5:
        return "bullish"
    elif change_pct < -0.5:
        return "bearish"
    return "neutral"


def fetch_quote(symbol: str) -> Optional[dict]:
    """Fetch a single index quote with retry and stale-cache fallback."""
    cache_key = f"quote_{symbol}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    def _fetch():
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
        change_pct = (change / prev_close) * 100 if prev_close else 0
        info = INDICES.get(symbol, {})
        market_status = get_market_status(info.get("country", "US"))
        return {
            "symbol":          symbol,
            "name":            info.get("name", symbol),
            "price":           round(price, 2),
            "change":          round(change, 2),
            "change_pct":      round(change_pct, 2),
            "open":            round(float(latest.get("Open", price)), 2),
            "high":            round(float(latest.get("High", price)), 2),
            "low":             round(float(latest.get("Low", price)), 2),
            "volume":          int(latest.get("Volume", 0)),
            "currency":        info.get("currency", "USD"),
            "country":         info.get("country", "US"),
            "market_status":   market_status["session"],
            "is_market_open":  market_status["is_open"],
            "trend":           _calculate_trend(change_pct),
            "timestamp":       datetime.now(timezone.utc).isoformat(),
            "is_stale":        False,
        }

    try:
        result = _retry(_fetch, retries=3, delay=1.0)
        if result:
            logger.info(
                "yfinance fetch OK symbol=%s price=%.2f change_pct=%.2f%%",
                symbol, result["price"], result["change_pct"],
            )
            cache.set(cache_key, result, ttl=60)
        return result
    except Exception as exc:
        logger.error(
            "yfinance exhausted retries symbol=%s — will serve stale cache. exc=%s",
            symbol, exc,
        )
        stale_data, _ = cache.get_stale(cache_key)
        if stale_data:
            logger.warning("yfinance returning stale data symbol=%s", symbol)
            stale_data["is_stale"] = True
            return stale_data
        return None


def fetch_history(symbol: str, period: str = "1Y") -> List[dict]:
    """Fetch OHLCV candlestick history."""
    cache_key = f"history_{symbol}_{period}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    def _fetch():
        period_map = {
            "1D":  ("1d",  "5m"),
            "1W":  ("5d",  "15m"),
            "5D":  ("5d",  "15m"),
            "1M":  ("1mo", "1d"),
            "6M":  ("6mo", "1d"),
            "1Y":  ("1y",  "1d"),
            "MAX": ("max", "1wk"),
        }
        yf_period, interval = period_map.get(period, ("1y", "1d"))
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=yf_period, interval=interval, timeout=20)
        hist = hist.dropna(subset=["Close"])
        if hist.empty:
            return []
        candles = []
        for row in hist.itertuples():
            dt = row.Index
            if hasattr(dt, "date"):
                time_str = (
                    str(dt.date()) if interval in ("1d", "1wk")
                    else str(int(dt.timestamp()))
                )
            else:
                time_str = str(dt)
            candles.append({
                "time":   time_str,
                "open":   round(float(row.Open), 2),
                "high":   round(float(row.High), 2),
                "low":    round(float(row.Low), 2),
                "close":  round(float(row.Close), 2),
                "volume": int(row.Volume) if row.Volume else 0,
            })
        return candles

    try:
        candles = _retry(_fetch, retries=2, delay=1.0)
        ttl = 300 if period in ("1M", "6M", "1Y", "MAX") else 60
        logger.info(
            "yfinance history OK symbol=%s period=%s candles=%d",
            symbol, period, len(candles),
        )
        cache.set(cache_key, candles, ttl=ttl)
        return candles
    except Exception as exc:
        logger.error(
            "yfinance history failed symbol=%s period=%s exc=%s",
            symbol, period, exc,
        )
        stale, _ = cache.get_stale(cache_key)
        if stale:
            logger.warning(
                "yfinance returning stale history symbol=%s period=%s",
                symbol, period,
            )
        return stale or []


def fetch_quote_batch(symbols: List[str]) -> List[dict]:
    """Fetch multiple quotes in parallel."""
    results = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        future_to_symbol = {executor.submit(fetch_quote, sym): sym for sym in symbols}
        for future in as_completed(future_to_symbol):
            try:
                result = future.result()
                if result:
                    results.append(result)
            except Exception as exc:
                sym = future_to_symbol[future]
                logger.warning("Quote fetch failed for %s: %s", sym, exc)
    symbol_order = {sym: i for i, sym in enumerate(symbols)}
    results.sort(key=lambda x: symbol_order.get(x["symbol"], 999))
    return results


def fetch_all_indices(country: Optional[str] = None) -> List[dict]:
    """Fetch all indices, optionally filtered by country code."""
    if country:
        symbols = COUNTRY_INDICES.get(country.upper(), [])
    else:
        symbols = list(INDICES.keys())
    return fetch_quote_batch(symbols)
