from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class IndexQuote(BaseModel):
    symbol: str
    name: str
    price: float
    change: float
    change_pct: float
    open: float
    high: float
    low: float
    volume: int
    market_cap: Optional[float] = None
    timestamp: str
    market_status: str


class CandleData(BaseModel):
    time: str  # ISO date string or unix timestamp string
    open: float
    high: float
    low: float
    close: float
    volume: int


class HistoryResponse(BaseModel):
    symbol: str
    name: str
    interval: str
    candles: List[CandleData]


class NewsArticle(BaseModel):
    id: str
    title: str
    summary: str
    source: str
    url: str
    published_at: str
    sentiment: str  # positive / negative / neutral


class NewsResponse(BaseModel):
    articles: List[NewsArticle]
    total: int
    fetched_at: str


class AIAnalysisRequest(BaseModel):
    symbol: str = Field(default="^NSEI", description="Market index symbol")
    period: str = Field(default="today", description="today, 5days, or why")
    question: Optional[str] = Field(default=None, description="Custom question for 'why' period")


class AIAnalysisResponse(BaseModel):
    title: str
    summary: str
    key_factors: List[str]
    sentiment: str  # bullish / bearish / neutral
    confidence: float = Field(ge=0.0, le=1.0)
    generated_at: str


class MarketStatus(BaseModel):
    is_open: bool
    session: str
    next_open: str
    timezone: str
