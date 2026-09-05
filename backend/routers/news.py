from fastapi import APIRouter, Query
from typing import Optional
from services.news_aggregator import fetch_news

router = APIRouter(prefix="/news", tags=["news"])

SUPPORTED_CATEGORIES = ["Markets", "Economy", "Earnings", "IPO", "Global", "Crypto", "Commodities"]


@router.get("/")
async def get_news(
    country: str = Query("IN", description="Country code: IN, US, GB, JP, ALL"),
    limit: int = Query(30, ge=1, le=100),
    category: Optional[str] = Query(None, description="Filter: Markets, Economy, Earnings, IPO, Global, Crypto, Commodities"),
):
    """Return strictly filtered financial news articles."""
    articles = fetch_news(country=country, limit=limit, category=category)
    return {
        "articles": articles,
        "total": len(articles),
        "categories": SUPPORTED_CATEGORIES,
        "country": country.upper(),
    }


@router.get("/categories")
async def get_categories():
    """Return supported news categories."""
    return {"categories": SUPPORTED_CATEGORIES}
