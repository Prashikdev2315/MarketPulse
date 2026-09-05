"""Unit tests for utils/cache.py — TTLCache.

All time-travel is done by patching ``time.time`` so the tests run in
milliseconds with no wall-clock sleeps.
"""
import threading
import time
from unittest.mock import patch

import pytest

from utils.cache import TTLCache


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now():
    return time.time()


# ── Basic get/set ─────────────────────────────────────────────────────────────

class TestBasicGetSet:
    def test_get_missing_key_returns_none(self, fresh_cache):
        assert fresh_cache.get("nonexistent") is None

    def test_set_and_get_within_ttl(self, fresh_cache):
        fresh_cache.set("k", "hello", ttl=60)
        assert fresh_cache.get("k") == "hello"

    def test_get_returns_none_after_ttl_expires(self, fresh_cache):
        base_time = 1_000_000.0
        with patch("time.time", side_effect=[
            base_time,          # set() → time.time() + ttl
            base_time + 61.0,   # get() expiry check (past TTL)
        ]):
            fresh_cache.set("k", "stale_value", ttl=60)
            result = fresh_cache.get("k")
        assert result is None

    def test_get_returns_value_just_before_ttl(self, fresh_cache):
        base_time = 1_000_000.0
        with patch("time.time", side_effect=[
            base_time,           # set()
            base_time + 59.9,    # get() — still live
        ]):
            fresh_cache.set("k", "alive", ttl=60)
            result = fresh_cache.get("k")
        assert result == "alive"

    def test_set_overwrites_existing_key(self, fresh_cache):
        fresh_cache.set("k", "first", ttl=60)
        fresh_cache.set("k", "second", ttl=60)
        assert fresh_cache.get("k") == "second"


# ── get_stale ─────────────────────────────────────────────────────────────────

class TestGetStale:
    def test_fresh_entry_is_not_stale(self, fresh_cache):
        base = 1_000_000.0
        with patch("time.time", side_effect=[base, base + 1.0]):
            fresh_cache.set("k", "v", ttl=60)
            value, is_stale = fresh_cache.get_stale("k")
        assert value == "v"
        assert is_stale is False

    def test_expired_entry_is_stale(self, fresh_cache):
        base = 1_000_000.0
        # The logging.warning() call inside get_stale also calls time.time()
        # internally (for the LogRecord timestamp), so we need 3 values:
        # [0] → set() computes expires_at, [1] → get_stale() computes now,
        # [2] → logging module's LogRecord.__init__ calls time.time()
        with patch("time.time", side_effect=[
            base,           # set()
            base + 120.0,   # get_stale() expiry check
            base + 120.0,   # logging LogRecord timestamp
        ]):
            fresh_cache.set("k", "old", ttl=60)
            value, is_stale = fresh_cache.get_stale("k")
        assert value == "old"       # still returned
        assert is_stale is True     # but flagged

    def test_missing_key_returns_none_and_stale(self, fresh_cache):
        value, is_stale = fresh_cache.get_stale("missing")
        assert value is None
        assert is_stale is True


# ── get_or_default ────────────────────────────────────────────────────────────

class TestGetOrDefault:
    def test_returns_value_when_fresh(self, fresh_cache):
        fresh_cache.set("k", 42, ttl=60)
        assert fresh_cache.get_or_default("k", default=99) == 42

    def test_returns_default_when_missing(self, fresh_cache):
        assert fresh_cache.get_or_default("missing", default="fallback") == "fallback"

    def test_returns_default_after_expiry(self, fresh_cache):
        base = 1_000_000.0
        with patch("time.time", side_effect=[base, base + 999.0]):
            fresh_cache.set("k", "gone", ttl=60)
            result = fresh_cache.get_or_default("k", default="default_val")
        assert result == "default_val"


# ── delete / clear / keys / size ──────────────────────────────────────────────

class TestMutationHelpers:
    def test_delete_removes_key(self, fresh_cache):
        fresh_cache.set("a", 1, ttl=60)
        fresh_cache.delete("a")
        assert fresh_cache.get("a") is None

    def test_delete_nonexistent_does_not_raise(self, fresh_cache):
        fresh_cache.delete("no_such_key")  # should not raise

    def test_clear_removes_all_entries(self, fresh_cache):
        fresh_cache.set("x", 1, ttl=60)
        fresh_cache.set("y", 2, ttl=60)
        fresh_cache.clear()
        assert fresh_cache.size() == 0

    def test_keys_returns_all_stored_keys(self, fresh_cache):
        fresh_cache.set("a", 1, ttl=60)
        fresh_cache.set("b", 2, ttl=60)
        assert set(fresh_cache.keys()) == {"a", "b"}

    def test_size_reflects_stored_count(self, fresh_cache):
        assert fresh_cache.size() == 0
        fresh_cache.set("z", 99, ttl=60)
        assert fresh_cache.size() == 1


# ── Eviction (max_entries) ────────────────────────────────────────────────────

class TestEviction:
    def test_exceeding_max_entries_evicts_soonest_expiring(self):
        """Insert max+1 entries with distinct TTLs; the soonest-expiring is evicted."""
        cache = TTLCache(max_entries=3)
        base = 1_000_000.0

        # Use controlled time so we control expiry order precisely.
        times = iter([
            base,           # set("short", ttl=10)  → expires base+10
            base,           # set("medium", ttl=50) → expires base+50
            base,           # set("long", ttl=200)  → expires base+200
            base,           # set("extra", ttl=100) → triggers eviction
        ])
        with patch("time.time", side_effect=times):
            cache.set("short",  "s", ttl=10)
            cache.set("medium", "m", ttl=50)
            cache.set("long",   "l", ttl=200)
            cache.set("extra",  "e", ttl=100)

        assert cache.size() == 3
        # "short" (expires soonest) must have been evicted
        assert "short" not in cache.keys()
        # The other three must still be present
        assert "medium" in cache.keys()
        assert "long" in cache.keys()
        assert "extra" in cache.keys()

    def test_no_eviction_when_under_cap(self, fresh_cache):
        for i in range(5):
            fresh_cache.set(f"k{i}", i, ttl=60)
        assert fresh_cache.size() == 5

    def test_unbounded_cache_never_evicts(self):
        cache = TTLCache(max_entries=None)
        for i in range(1500):
            cache.set(f"k{i}", i, ttl=60)
        assert cache.size() == 1500


# ── Thread safety ─────────────────────────────────────────────────────────────

class TestThreadSafety:
    def test_concurrent_set_and_get_no_exceptions(self):
        """10 threads hammering set/get concurrently should never raise."""
        cache = TTLCache(max_entries=50)
        errors = []

        def worker(thread_id):
            try:
                for i in range(20):
                    cache.set(f"key_{thread_id}_{i}", i, ttl=10)
                    cache.get(f"key_{thread_id}_{i}")
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(t,)) for t in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == [], f"Thread errors: {errors}"
