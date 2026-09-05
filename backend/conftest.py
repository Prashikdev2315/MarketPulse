"""Shared pytest fixtures for the trading backend test suite.

All external I/O is mocked so tests run offline with no API keys required.
"""
import threading
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from utils.cache import TTLCache


# ── Cache fixture ─────────────────────────────────────────────────────────────

@pytest.fixture
def fresh_cache():
    """A brand-new TTLCache with a small cap so eviction tests are cheap."""
    return TTLCache(max_entries=10)


# ── Gemini mock fixture ───────────────────────────────────────────────────────

CANNED_GEMINI_JSON = """{
  "title": "Markets Test Headline",
  "sentiment": "bullish",
  "confidence": 0.75,
  "sections": [
    {
      "id": "market_summary",
      "title": "Market Summary",
      "content": "Test content paragraph.",
      "icon": "chart"
    }
  ],
  "key_factors": ["Factor A", "Factor B"],
  "bullish_signals": ["Signal 1"],
  "bearish_signals": []
}"""


@pytest.fixture
def mock_gemini():
    """Patch _call_gemini to return a canned JSON string without any network call."""
    with patch("services.ai_analyzer._call_gemini", return_value=CANNED_GEMINI_JSON) as m:
        yield m


# ── yfinance mock fixture ─────────────────────────────────────────────────────

def _make_fake_history():
    """Return a two-row DataFrame that mimics yf.Ticker().history()."""
    data = {
        "Open":   [100.0, 101.0],
        "High":   [105.0, 106.0],
        "Low":    [99.0,  100.0],
        "Close":  [102.0, 103.0],
        "Volume": [1_000_000, 1_100_000],
    }
    index = pd.to_datetime(["2024-01-02", "2024-01-03"])
    return pd.DataFrame(data, index=index)


@pytest.fixture
def mock_yfinance():
    """Patch yfinance.Ticker so no real HTTP requests are made."""
    fake_ticker = MagicMock()
    fake_ticker.history.return_value = _make_fake_history()

    with patch("yfinance.Ticker", return_value=fake_ticker) as m:
        yield m
