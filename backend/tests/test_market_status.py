"""Unit tests for services/yahoo_finance.py — get_market_status().

All wall-clock time is frozen via freezegun so tests are deterministic
and run at the same speed regardless of when they execute.

_TZ_MAP entries under test:
  IN  → Asia/Kolkata      09:15 – 15:30
  US  → America/New_York  09:30 – 16:00
  GB  → Europe/London     08:00 – 16:30
  JP  → Asia/Tokyo        09:00 – 15:30
  CN  → Asia/Shanghai     09:30 – 15:00
"""
import pytest
from freezegun import freeze_time

from services.yahoo_finance import get_market_status, _TZ_MAP, _HOLIDAYS


# ── Helper to build an ISO datetime string for a given local time ─────────────

def _iso(country: str, date: str, hhmm: str) -> str:
    """Return e.g. '2024-03-15T10:00:00+05:30' for IN 10:00 on 2024-03-15."""
    tz_name = _TZ_MAP[country][0]
    import pytz
    from datetime import datetime
    tz = pytz.timezone(tz_name)
    naive = datetime.strptime(f"{date} {hhmm}", "%Y-%m-%d %H:%M")
    local_dt = tz.localize(naive)
    return local_dt.isoformat()


# ── India (IN) ────────────────────────────────────────────────────────────────

class TestMarketStatusIN:
    COUNTRY = "IN"

    def test_open_during_session(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "11:00")  # Friday, 11:00 IST
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is True
        assert status["session"] == "Open"

    def test_pre_market_before_open(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "08:00")  # before 09:15
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Pre-Market"

    def test_closed_after_session(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "16:00")  # after 15:30
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Closed"

    def test_closed_on_weekend_saturday(self):
        ts = _iso(self.COUNTRY, "2024-03-16", "11:00")  # Saturday
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Weekend"

    def test_closed_on_weekend_sunday(self):
        ts = _iso(self.COUNTRY, "2024-03-17", "11:00")  # Sunday
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Weekend"

    def test_closed_on_republic_day(self):
        # 01-26 is in IN holiday set
        ts = _iso(self.COUNTRY, "2024-01-26", "11:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Holiday"

    def test_closed_on_independence_day(self):
        ts = _iso(self.COUNTRY, "2024-08-15", "11:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Holiday"


# ── United States (US) ────────────────────────────────────────────────────────

class TestMarketStatusUS:
    COUNTRY = "US"

    def test_open_during_session(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "12:00")  # Friday noon ET
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is True
        assert status["session"] == "Open"

    def test_pre_market_before_930(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "09:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Pre-Market"

    def test_closed_after_1600(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "16:30")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Closed"

    def test_closed_on_independence_day(self):
        ts = _iso(self.COUNTRY, "2024-07-04", "12:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Holiday"

    def test_closed_on_christmas(self):
        ts = _iso(self.COUNTRY, "2024-12-25", "12:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Holiday"


# ── United Kingdom (GB) ───────────────────────────────────────────────────────

class TestMarketStatusGB:
    COUNTRY = "GB"

    def test_open_during_session(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "10:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is True

    def test_closed_before_0800(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "07:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Pre-Market"

    def test_closed_on_boxing_day(self):
        ts = _iso(self.COUNTRY, "2024-12-26", "10:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Holiday"


# ── Japan (JP) ────────────────────────────────────────────────────────────────

class TestMarketStatusJP:
    COUNTRY = "JP"

    def test_open_during_session(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "10:30")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is True

    def test_closed_after_1530(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "16:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Closed"

    def test_closed_on_new_years(self):
        ts = _iso(self.COUNTRY, "2024-01-01", "10:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Holiday"


# ── China (CN) ────────────────────────────────────────────────────────────────

class TestMarketStatusCN:
    COUNTRY = "CN"

    def test_open_during_session(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "11:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is True

    def test_closed_after_1500(self):
        ts = _iso(self.COUNTRY, "2024-03-15", "15:30")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Closed"

    def test_closed_on_national_day(self):
        ts = _iso(self.COUNTRY, "2024-10-01", "11:00")
        with freeze_time(ts):
            status = get_market_status(self.COUNTRY)
        assert status["is_open"] is False
        assert status["session"] == "Holiday"


# ── Edge cases ────────────────────────────────────────────────────────────────

class TestMarketStatusEdgeCases:
    def test_unknown_country_returns_gracefully(self):
        """An unknown country should not raise; it should return a safe default."""
        status = get_market_status("ZZ")
        assert "is_open" in status
        assert "session" in status

    def test_all_tz_map_countries_have_no_exception(self):
        for country in _TZ_MAP:
            ts = _iso(country, "2024-03-15", "12:00")
            with freeze_time(ts):
                status = get_market_status(country)
            assert isinstance(status["is_open"], bool)

    def test_exact_open_boundary(self):
        """Market should be open exactly at open time (open_min <= current_min)."""
        # IN opens at 09:15
        ts = _iso("IN", "2024-03-15", "09:15")
        with freeze_time(ts):
            status = get_market_status("IN")
        assert status["is_open"] is True

    def test_exact_close_boundary(self):
        """Market should still be open exactly at close time (<= close_min)."""
        # IN closes at 15:30
        ts = _iso("IN", "2024-03-15", "15:30")
        with freeze_time(ts):
            status = get_market_status("IN")
        assert status["is_open"] is True

    def test_one_minute_after_close_is_closed(self):
        ts = _iso("IN", "2024-03-15", "15:31")
        with freeze_time(ts):
            status = get_market_status("IN")
        assert status["is_open"] is False
