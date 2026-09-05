"""
Heatmap data service.

Returns a list of stocks grouped by sector with live price/change data,
suitable for rendering a Bloomberg-style market heatmap on the frontend.
Data is sourced from yfinance (free, no API key) and cached with a 60s TTL.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

from utils.cache import cache
from services.stock_service import get_stock_quote, get_stock_info

logger = logging.getLogger(__name__)

# ── Curated stock universe per country ────────────────────────────────────────
# Each entry: (display_name, yahoo_symbol, sector, rough_market_cap_rank)
# Sectors are kept consistent so the frontend can group/colour them easily.

HEATMAP_STOCKS: Dict[str, List[tuple]] = {
    "IN": [
        # (name, symbol, sector)
        ("Reliance",        "RELIANCE.NS",   "Energy"),
        ("TCS",             "TCS.NS",         "Technology"),
        ("HDFC Bank",       "HDFCBANK.NS",    "Financials"),
        ("Infosys",         "INFY.NS",        "Technology"),
        ("ICICI Bank",      "ICICIBANK.NS",   "Financials"),
        ("Bharti Airtel",   "BHARTIARTL.NS",  "Communication"),
        ("SBI",             "SBIN.NS",        "Financials"),
        ("Bajaj Auto",      "BAJAJ-AUTO.NS",  "Consumer Disc."),
        ("HCL Tech",        "HCLTECH.NS",     "Technology"),
        ("Wipro",           "WIPRO.NS",       "Technology"),
        ("Axis Bank",       "AXISBANK.NS",    "Financials"),
        ("Tech Mahindra",   "TECHM.NS",       "Technology"),
        ("Tata Steel",      "TATASTEEL.NS",   "Materials"),
        ("Sun Pharma",      "SUNPHARMA.NS",   "Health Care"),
        ("Maruti Suzuki",   "MARUTI.NS",      "Consumer Disc."),
        ("ONGC",            "ONGC.NS",        "Energy"),
        ("Bajaj Finance",   "BAJFINANCE.NS",  "Financials"),
        ("Asian Paints",    "ASIANPAINT.NS",  "Materials"),
        ("Titan",           "TITAN.NS",       "Consumer Disc."),
        ("Nestle India",    "NESTLEIND.NS",   "Consumer Staples"),
        ("L&T",             "LT.NS",          "Industrials"),
        ("Power Grid",      "POWERGRID.NS",   "Utilities"),
        ("NTPC",            "NTPC.NS",        "Utilities"),
        ("Dr Reddys",       "DRREDDY.NS",     "Health Care"),
    ],
    "US": [
        ("Apple",           "AAPL",   "Technology"),
        ("Microsoft",       "MSFT",   "Technology"),
        ("NVIDIA",          "NVDA",   "Technology"),
        ("Amazon",          "AMZN",   "Consumer Disc."),
        ("Alphabet",        "GOOGL",  "Communication"),
        ("Meta",            "META",   "Communication"),
        ("Tesla",           "TSLA",   "Consumer Disc."),
        ("Berkshire",       "BRK-B",  "Financials"),
        ("JPMorgan",        "JPM",    "Financials"),
        ("Visa",            "V",      "Financials"),
        ("UnitedHealth",    "UNH",    "Health Care"),
        ("Exxon Mobil",     "XOM",    "Energy"),
        ("Johnson & J",     "JNJ",    "Health Care"),
        ("Walmart",         "WMT",    "Consumer Staples"),
        ("Procter & G",     "PG",     "Consumer Staples"),
        ("Mastercard",      "MA",     "Financials"),
        ("Home Depot",      "HD",     "Consumer Disc."),
        ("Chevron",         "CVX",    "Energy"),
        ("AbbVie",          "ABBV",   "Health Care"),
        ("AMD",             "AMD",    "Technology"),
        ("Netflix",         "NFLX",   "Communication"),
        ("Salesforce",      "CRM",    "Technology"),
        ("Boeing",          "BA",     "Industrials"),
        ("Caterpillar",     "CAT",    "Industrials"),
    ],
    "GB": [
        ("Shell",           "SHEL.L",  "Energy"),
        ("AstraZeneca",     "AZN.L",   "Health Care"),
        ("HSBC",            "HSBA.L",  "Financials"),
        ("Unilever",        "ULVR.L",  "Consumer Staples"),
        ("BP",              "BP.L",    "Energy"),
        ("GSK",             "GSK.L",   "Health Care"),
        ("Rio Tinto",       "RIO.L",   "Materials"),
        ("Lloyds",          "LLOY.L",  "Financials"),
        ("Barclays",        "BARC.L",  "Financials"),
        ("BT Group",        "BT-A.L",  "Communication"),
        ("Rolls-Royce",     "RR.L",    "Industrials"),
        ("Diageo",          "DGE.L",   "Consumer Staples"),
        ("BAE Systems",     "BA.L",    "Industrials"),
        ("Tesco",           "TSCO.L",  "Consumer Staples"),
        ("Vodafone",        "VOD.L",   "Communication"),
        ("National Grid",   "NG.L",    "Utilities"),
    ],
    "JP": [
        ("Toyota",          "7203.T",  "Consumer Disc."),
        ("Sony",            "6758.T",  "Technology"),
        ("Mitsubishi UFJ",  "8306.T",  "Financials"),
        ("Softbank",        "9984.T",  "Communication"),
        ("Keyence",         "6861.T",  "Technology"),
        ("Nintendo",        "7974.T",  "Technology"),
        ("Honda",           "7267.T",  "Consumer Disc."),
        ("Recruit",         "6098.T",  "Industrials"),
        ("Shin-Etsu",       "4063.T",  "Materials"),
        ("Hitachi",         "6501.T",  "Industrials"),
        ("Fanuc",           "6954.T",  "Industrials"),
        ("Sumitomo Mitsui", "8316.T",  "Financials"),
        ("Daiichi Sankyo",  "4568.T",  "Health Care"),
        ("Takeda",          "4502.T",  "Health Care"),
        ("Denso",           "6902.T",  "Consumer Disc."),
    ],
    "CN": [
        ("Tencent",         "0700.HK",  "Technology"),
        ("Alibaba",         "9988.HK",  "Consumer Disc."),
        ("Meituan",         "3690.HK",  "Consumer Disc."),
        ("JD.com",          "9618.HK",  "Consumer Disc."),
        ("BYD",             "1211.HK",  "Consumer Disc."),
        ("ICBC",            "1398.HK",  "Financials"),
        ("CNOOC",           "0883.HK",  "Energy"),
        ("Ping An",         "2318.HK",  "Financials"),
        ("China Mobile",    "0941.HK",  "Communication"),
        ("NetEase",         "9999.HK",  "Technology"),
        ("Li Auto",         "2015.HK",  "Consumer Disc."),
        ("Xiaomi",          "1810.HK",  "Technology"),
    ],
}

# Sector display order (determines visual grouping)
SECTOR_ORDER = [
    "Technology", "Financials", "Communication", "Consumer Disc.",
    "Health Care", "Energy", "Industrials", "Consumer Staples",
    "Materials", "Utilities", "Real Estate",
]


def _fetch_one(name: str, symbol: str, sector: str) -> Optional[Dict[str, Any]]:
    """Fetch quote for a single ticker and return a heatmap cell dict."""
    try:
        quote = get_stock_quote(symbol)
        if not quote:
            return None
        # Market cap from info (cached alongside quote)
        info = get_stock_info(symbol) or {}
        market_cap = info.get("market_cap") or 0
        return {
            "symbol":     symbol,
            "name":       name,
            "sector":     sector,
            "price":      quote.get("price"),
            "change_pct": quote.get("change_pct"),
            "change":     quote.get("change"),
            "volume":     quote.get("volume"),
            "currency":   quote.get("currency", "USD"),
            "market_cap": market_cap,
            "high":       quote.get("high"),
            "low":        quote.get("low"),
            "open":       quote.get("open"),
        }
    except Exception as exc:
        logger.warning("heatmap fetch failed for %s: %s", symbol, exc)
        return None


def get_heatmap_data(country: str = "IN") -> List[Dict[str, Any]]:
    """Return heatmap cells for the given country, fetched in parallel.

    Each cell contains: symbol, name, sector, price, change_pct, market_cap.
    Results are sorted by sector (SECTOR_ORDER) then by abs(change_pct) desc.
    Cached for 60 seconds.
    """
    code = country.upper()
    cache_key = f"heatmap_{code}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    stocks = HEATMAP_STOCKS.get(code) or HEATMAP_STOCKS["US"]
    results: List[Dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {
            executor.submit(_fetch_one, name, sym, sector): (name, sym, sector)
            for name, sym, sector in stocks
        }
        for fut in as_completed(futures):
            try:
                cell = fut.result()
                if cell:
                    results.append(cell)
            except Exception as exc:
                logger.warning("heatmap future error: %s", exc)

    # Sort: sector order → absolute change desc within sector
    sector_rank = {s: i for i, s in enumerate(SECTOR_ORDER)}
    results.sort(key=lambda x: (
        sector_rank.get(x["sector"], 99),
        -abs(x.get("change_pct") or 0),
    ))

    cache.set(cache_key, results, ttl=60)
    return results
