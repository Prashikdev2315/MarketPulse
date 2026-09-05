from fastapi import APIRouter, Query, HTTPException, Request
from typing import Optional
from datetime import datetime, timezone

from slowapi import Limiter
from slowapi.util import get_remote_address

from services.yahoo_finance import (
    fetch_all_indices,
    fetch_quote,
    fetch_history,
    get_market_status,
    INDICES,
    COUNTRY_INDICES,
)
from services.market_data_service import (
    COUNTRY_INFO,
    get_all_countries_summary,
    get_country_market_data,
)
from services.heatmap_service import get_heatmap_data

router = APIRouter(prefix="/market", tags=["market"])
limiter = Limiter(key_func=get_remote_address)

# Single source of truth for "is this a country we know about?".
SUPPORTED_COUNTRIES = set(COUNTRY_INFO.keys())


def _validate_country(country: str) -> str:
    """Normalise to uppercase and 404 on unknown codes instead of silently
    returning an empty payload."""
    code = country.upper()
    if code not in SUPPORTED_COUNTRIES:
        raise HTTPException(
            status_code=404,
            detail=f"Unsupported country code '{country}'. "
                   f"Supported: {sorted(SUPPORTED_COUNTRIES)}",
        )
    return code


@router.get("/indices")
@limiter.limit("30/minute")
async def get_all_indices(
    request: Request,
    country: Optional[str] = Query(None, description="Country code: IN, US, GB, JP"),
):
    """Return all index quotes, optionally filtered by country code."""
    if country:
        code = _validate_country(country)
        data = get_country_market_data(code)
        return {
            "data": data["indices"],
            "count": data["count"],
            "last_updated": data["last_updated"],
            "is_stale": data["is_stale"],
            "market_status": data["market_status"],
        }
    else:
        indices = fetch_all_indices()
        any_stale = any(i.get("is_stale", False) for i in indices)
        return {
            "data": indices,
            "count": len(indices),
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "is_stale": any_stale,
        }


@router.get("/quote/{symbol:path}")
@limiter.limit("30/minute")
async def get_quote(request: Request, symbol: str):
    """Return the latest quote for a single index symbol."""
    quote = fetch_quote(symbol)
    if not quote:
        raise HTTPException(status_code=404, detail=f"Could not fetch quote for {symbol}")
    return quote


@router.get("/history/{symbol:path}")
@limiter.limit("20/minute")
async def get_history(
    request: Request,
    symbol: str,
    period: str = Query("1Y", description="1D, 1W, 1M, 6M, 1Y, MAX"),
):
    """Return OHLCV candlestick history for a symbol."""
    candles = fetch_history(symbol, period)
    info = INDICES.get(symbol, {})
    return {
        "symbol": symbol,
        "name":   info.get("name", symbol),
        "period": period,
        "candles": candles,
        "count":   len(candles),
    }


@router.get("/status/{country}")
async def get_market_status_endpoint(country: str):
    """Return current market open/closed status for a country."""
    code = _validate_country(country)
    status = get_market_status(code)
    return {
        "country": code,
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/countries")
async def get_countries():
    """Return list of supported countries with status."""
    summaries = get_all_countries_summary()
    return {"countries": summaries}


@router.get("/overview/{country}")
async def get_country_overview(country: str):
    """Return full market overview for a country."""
    code = _validate_country(country)
    data = get_country_market_data(code)
    if not data["indices"]:
        raise HTTPException(status_code=503, detail="Market data temporarily unavailable")
    return data


@router.get("/heatmap")
@limiter.limit("10/minute")
async def get_market_heatmap(
    request: Request,
    country: str = Query("IN", description="Country code: IN, US, GB, JP, CN"),
):
    """Return sector-grouped stock heatmap data for a country.

    Each cell: symbol, name, sector, price, change_pct, market_cap, currency.
    Results are ordered by sector then by abs(change_pct) desc.
    Cached 60 s server-side.

    Rate limited to 10 requests/minute — fans out to many yfinance calls.
    """
    code = _validate_country(country)
    cells = get_heatmap_data(code)
    return {
        "country": code,
        "count": len(cells),
        "cells": cells,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
