"""Router-level integration tests using FastAPI's TestClient.

All external I/O (yfinance, Gemini, RSS feeds, Yahoo Search) is patched so
these tests run fully offline with no API keys required.

Covered:
  GET  /market/indices          → 200, non-empty list in data[]
  GET  /stocks/quote/{symbol}   → 200, response has quote.symbol
  GET  /news/                   → 200, response has articles[]
"""
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Shared fake payloads
# ---------------------------------------------------------------------------

_FAKE_INDEX = {
    "symbol": "^NSEI",
    "name": "NIFTY 50",
    "price": 22000.0,
    "change": 120.0,
    "change_pct": 0.55,
    "open": 21900.0,
    "high": 22100.0,
    "low": 21850.0,
    "volume": 5_000_000,
    "currency": "INR",
    "country": "IN",
    "market_status": "Open",
    "is_market_open": True,
    "trend": "bullish",
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "is_stale": False,
}

_FAKE_QUOTE = {
    "symbol": "AAPL",
    "name": "Apple Inc.",
    "price": 175.0,
    "change": 2.0,
    "change_pct": 1.16,
    "open": 173.0,
    "high": 176.0,
    "low": 172.5,
    "volume": 70_000_000,
    "currency": "USD",
    "country": "US",
    "market_status": "Open",
    "is_market_open": True,
    "trend": "bullish",
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "is_stale": False,
}

_FAKE_INFO = {
    "symbol": "AAPL",
    "name": "Apple Inc.",
    "currency": "USD",
    "exchange": "NASDAQ",
    "sector": "Technology",
    "industry": "Consumer Electronics",
    "market_cap": 2_800_000_000_000,
    "trailing_pe": 28.5,
    "forward_pe": 26.0,
    "beta": 1.2,
    "fifty_two_week_high": 198.0,
    "fifty_two_week_low": 124.0,
    "average_volume": 55_000_000,
    "dividend_yield": 0.005,
    "market_state": "REGULAR",
    "quote_type": "EQUITY",
    "tradingViewSymbol": "NASDAQ:AAPL",
    "country": "US",
}

_FAKE_ARTICLE = {
    "id": "abc123",
    "title": "Market gains on positive sentiment",
    "summary": "Indices closed higher.",
    "source": "Reuters",
    "url": "https://example.com/article",
    "published_at": datetime.now(timezone.utc).isoformat(),
    "sentiment": "positive",
    "sentiment_label": "Bullish",
    "category": "Markets",
    "affected_sectors": ["Technology"],
    "market_impact": "medium",
    "relevance_score": 7,
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    """
    Build a TestClient with all external calls stubbed out at import time.

    Patches are applied *before* importing main so that modules which call
    external services at module level (e.g. loading market status) receive
    the mocks immediately.
    """
    fake_ticker = MagicMock()
    fake_ticker.history.return_value = MagicMock(
        empty=False,
        iterrows=lambda: iter([]),
        __len__=lambda self: 2,
    )
    fake_ticker.fast_info = MagicMock(
        last_price=175.0,
        open=173.0,
        day_high=176.0,
        day_low=172.5,
        three_month_average_volume=55_000_000,
    )
    fake_ticker.info = {
        "shortName": "Apple Inc.",
        "currency": "USD",
        "exchange": "NASDAQ",
        "sector": "Technology",
        "industry": "Consumer Electronics",
        "marketCap": 2_800_000_000_000,
        "trailingPE": 28.5,
        "forwardPE": 26.0,
        "beta": 1.2,
        "fiftyTwoWeekHigh": 198.0,
        "fiftyTwoWeekLow": 124.0,
        "averageVolume": 55_000_000,
        "dividendYield": 0.005,
        "quoteType": "EQUITY",
        "marketState": "REGULAR",
    }

    with patch("yfinance.Ticker", return_value=fake_ticker):
        with patch("services.yahoo_finance.fetch_all_indices", return_value=[_FAKE_INDEX]):
            with patch("services.yahoo_finance.fetch_quote", return_value=_FAKE_QUOTE):
                with patch("services.stock_service.get_stock_quote", return_value=_FAKE_QUOTE):
                    with patch("services.stock_service.get_stock_info", return_value=_FAKE_INFO):
                        with patch("services.stock_service.fetch_stock_news", return_value=[_FAKE_ARTICLE]):
                            with patch("services.news_aggregator.fetch_news", return_value=[_FAKE_ARTICLE]):
                                with patch(
                                    "services.ai_analyzer._call_gemini",
                                    return_value='{"title":"t","sentiment":"bullish","confidence":0.8,"key_factors":[]}',
                                ):
                                    from main import app  # noqa: PLC0415
                                    yield TestClient(app)


# ---------------------------------------------------------------------------
# GET /market/indices
# ---------------------------------------------------------------------------

class TestMarketIndices:
    def test_returns_200(self, client):
        response = client.get("/market/indices")
        assert response.status_code == 200, response.text

    def test_response_has_data_list(self, client):
        response = client.get("/market/indices")
        body = response.json()
        assert "data" in body, f"Missing 'data' key: {body}"
        assert isinstance(body["data"], list), "data should be a list"

    def test_data_list_is_non_empty(self, client):
        response = client.get("/market/indices")
        body = response.json()
        assert len(body["data"]) > 0, "Expected at least one index in data[]"

    def test_country_filter_returns_200(self, client):
        """?country=IN should work and still return a list."""
        response = client.get("/market/indices?country=IN")
        assert response.status_code == 200, response.text

    def test_invalid_country_returns_404(self, client):
        response = client.get("/market/indices?country=ZZ")
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# GET /stocks/quote/{symbol}
# ---------------------------------------------------------------------------

class TestStocksQuote:
    def test_returns_200(self, client):
        response = client.get("/stocks/quote/AAPL")
        assert response.status_code == 200, response.text

    def test_response_has_quote_key(self, client):
        response = client.get("/stocks/quote/AAPL")
        body = response.json()
        assert "quote" in body, f"Missing 'quote' key: {body}"

    def test_quote_contains_symbol(self, client):
        response = client.get("/stocks/quote/AAPL")
        body = response.json()
        assert "symbol" in body["quote"], "quote should contain a symbol field"
        assert body["quote"]["symbol"] == "AAPL"

    def test_response_has_fetched_at(self, client):
        response = client.get("/stocks/quote/AAPL")
        body = response.json()
        assert "fetched_at" in body, "response should contain fetched_at timestamp"


# ---------------------------------------------------------------------------
# GET /news/
# ---------------------------------------------------------------------------

class TestNewsEndpoint:
    def test_returns_200(self, client):
        response = client.get("/news/")
        assert response.status_code == 200, response.text

    def test_response_has_articles_key(self, client):
        response = client.get("/news/")
        body = response.json()
        assert "articles" in body, f"Missing 'articles' key: {body}"

    def test_articles_is_a_list(self, client):
        response = client.get("/news/")
        body = response.json()
        assert isinstance(body["articles"], list), "articles should be a list"

    def test_articles_list_is_non_empty(self, client):
        response = client.get("/news/")
        body = response.json()
        assert len(body["articles"]) > 0, "Expected at least one article"

    def test_country_param_accepted(self, client):
        """?country=US should still return 200."""
        response = client.get("/news/?country=US")
        assert response.status_code == 200, response.text
