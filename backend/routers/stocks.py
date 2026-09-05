"""Stock (individual equity) router.

Endpoints for searching, quoting, and AI-analyzing arbitrary stocks — the
index-only ``/market`` router cannot do this. Reuses ``fetch_history`` from the
yahoo_finance service (which works for any symbol) and delegates quote/info/news
to the new ``stock_service`` module.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Query, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from services.yahoo_finance import fetch_history
from services.stock_service import (
    search_stocks,
    get_stock_info,
    get_stock_quote,
    get_trending,
    fetch_stock_news,
)
from services.ai_analyzer import analyze_stock

router = APIRouter(prefix="/stocks", tags=["stocks"])
limiter = Limiter(key_func=get_remote_address)


def _resolve_symbol_or_404(symbol: str):
    """Return (quote, info) for a symbol, or raise 404 if neither resolves."""
    info = get_stock_info(symbol)
    quote = get_stock_quote(symbol)
    if not quote and not info:
        raise HTTPException(
            status_code=404,
            detail=f"Could not find any data for symbol '{symbol}'. "
                   "Check the ticker (e.g. RELIANCE.NS, AAPL, TSLA, SHEL.L).",
        )
    return quote, info


@router.get("/search")
@limiter.limit("20/minute")
async def search(
    request: Request,
    q: str = Query(..., min_length=1, description="Company name or ticker"),
    country: Optional[str] = Query(None, description="Restrict to a country code: IN, US, GB, JP, CN"),
):
    """Search stocks by name or ticker via the Yahoo public search API."""
    results = search_stocks(q, country)
    return {
        "query": q,
        "country": country,
        "count": len(results),
        "results": results,
    }


@router.get("/trending")
async def trending(
    country: Optional[str] = Query(None, description="Country code: IN, US, GB, JP, CN"),
):
    """Return curated trending / popular stocks for a country."""
    stocks = get_trending(country)
    return {
        "country": (country or "US").upper(),
        "count": len(stocks),
        "stocks": stocks,
    }


@router.get("/quote/{symbol:path}")
@limiter.limit("30/minute")
async def quote(request: Request, symbol: str):
    """Single-stock quote, enriched with company fundamentals (one response)."""
    quote_data, info = _resolve_symbol_or_404(symbol)
    return {
        "quote": quote_data,
        "info": info,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/info/{symbol:path}")
async def info(symbol: str):
    """Company fundamentals only (sector, mcap, P/E, 52W range, ...)."""
    data = get_stock_info(symbol)
    if not data:
        raise HTTPException(status_code=404, detail=f"No info for symbol '{symbol}'")
    return data


@router.get("/history/{symbol:path}")
async def history(
    symbol: str,
    period: str = Query("1Y", description="1D, 1W, 1M, 6M, 1Y, MAX"),
):
    """OHLCV history — thin wrapper over the existing ``fetch_history``."""
    candles = fetch_history(symbol, period)
    return {
        "symbol": symbol,
        "period": period,
        "candles": candles,
        "count": len(candles),
    }


@router.get("/news/{symbol:path}")
async def news(
    symbol: str,
    limit: int = Query(15, ge=1, le=50),
):
    """Company-specific news via Google News RSS."""
    info = get_stock_info(symbol) or {}
    company_name = info.get("name", symbol)
    articles = fetch_stock_news(symbol, company_name, limit)
    return {
        "symbol": symbol,
        "company": company_name,
        "articles": articles,
        "total": len(articles),
    }


@router.post("/analyze")
@limiter.limit("5/minute")
async def analyze(
    request: Request,
    symbol: str = Body(..., embed=True, description="Yahoo stock symbol, e.g. RELIANCE.NS"),
    period: str = Body("today", embed=True, description="today, 5days, 1month, why, forecast"),
):
    """AI analysis for a single stock. Falls back to a rule-based view when
    GEMINI_API_KEY is not configured.

    Rate limited to 5 requests/minute per IP to protect Gemini API quota.
    """
    quote_data, info = _resolve_symbol_or_404(symbol)
    company_name = (info or {}).get("name", symbol)
    news_articles = fetch_stock_news(symbol, company_name, limit=15)
    return analyze_stock(symbol, quote_data, info, news_articles, period)
