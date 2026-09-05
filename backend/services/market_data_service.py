"""
Unified Market Data Service — normalizes data from all sources.
"""
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from services.yahoo_finance import fetch_all_indices, get_market_status, COUNTRY_INDICES
from utils.cache import cache


COUNTRY_INFO = {
    "IN": {"name": "India",          "flag": "🇮🇳", "currency": "INR", "primary_index": "^NSEI"},
    "US": {"name": "United States",  "flag": "🇺🇸", "currency": "USD", "primary_index": "^GSPC"},
    "GB": {"name": "United Kingdom", "flag": "🇬🇧", "currency": "GBP", "primary_index": "^FTSE"},
    "JP": {"name": "Japan",          "flag": "🇯🇵", "currency": "JPY", "primary_index": "^N225"},
    "CN": {"name": "China",          "flag": "🇨🇳", "currency": "CNY", "primary_index": "000001.SS"},
}


def get_country_market_data(country: str) -> Dict[str, Any]:
    """Get normalized market data for a country."""
    country_upper = country.upper()
    cache_key = f"market_data_{country_upper}"

    indices = fetch_all_indices(country_upper)
    info = COUNTRY_INFO.get(country_upper, {})
    market_status = get_market_status(country_upper)
    any_stale = any(i.get("is_stale", False) for i in indices)

    result = {
        "country": country_upper,
        "country_name": info.get("name", country_upper),
        "flag": info.get("flag", ""),
        "currency": info.get("currency", "USD"),
        "primary_index": info.get("primary_index", ""),
        "market_status": market_status,
        "indices": indices,
        "count": len(indices),
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "is_stale": any_stale,
    }
    return result


def get_all_countries_summary() -> List[Dict[str, Any]]:
    """Get a quick summary for all supported countries."""
    summaries = []
    for code, info in COUNTRY_INFO.items():
        market_status = get_market_status(code)
        summaries.append({
            "code": code,
            "name": info["name"],
            "flag": info["flag"],
            "currency": info["currency"],
            "primary_index": info["primary_index"],
            "market_status": market_status,
            "indices_count": len(COUNTRY_INDICES.get(code, [])),
        })
    return summaries
