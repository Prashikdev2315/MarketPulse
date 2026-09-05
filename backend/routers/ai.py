from fastapi import APIRouter, Body, HTTPException, Request
from typing import Optional
from services.yahoo_finance import fetch_all_indices
from services.news_aggregator import fetch_news
from services.ai_analyzer import analyze_market
from services.market_data_service import COUNTRY_INFO
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter(prefix="/ai", tags=["ai"])
limiter = Limiter(key_func=get_remote_address)

SUPPORTED_PERIODS = ["today", "5days", "1month", "why", "forecast"]
SUPPORTED_COUNTRIES = set(COUNTRY_INFO.keys())


@router.post("/analyze")
@limiter.limit("5/minute")
async def analyze(
    request: Request,
    period: str = Body("today", embed=True, description="today, 5days, 1month, why, forecast"),
    country: str = Body("IN", embed=True, description="Country code: IN, US, GB, JP"),
    question: Optional[str] = Body(None, embed=True, description="Custom question for 'why' period"),
):
    """
    Generate an AI market analysis report using Google Gemini.
    Falls back to rule-based summary when API key is not configured.

    Rate limited to 5 requests per minute per IP to protect Gemini API quota.
    """
    code = country.upper()
    if code not in SUPPORTED_COUNTRIES:
        raise HTTPException(
            status_code=404,
            detail=f"Unsupported country '{country}'. Supported: {sorted(SUPPORTED_COUNTRIES)}",
        )
    if period not in SUPPORTED_PERIODS:
        period = "today"

    market_data = fetch_all_indices(code)
    news = fetch_news(country=code, limit=25)
    return analyze_market(market_data, news, period, question)


@router.get("/periods")
async def get_periods():
    """Return supported analysis periods (useful for client discovery)."""
    return {"periods": SUPPORTED_PERIODS, "countries": sorted(SUPPORTED_COUNTRIES)}
