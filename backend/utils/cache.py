"""Thread-safe TTL cache with an optional size bound.

Used by services that may run inside a ThreadPoolExecutor (parallel quote
fetches), so every mutation is guarded by a reentrant lock. An optional
``max_entries`` cap prevents unbounded growth on long-running servers — when
the cap is exceeded the oldest-expiring entries are evicted first.
"""
import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Optional, Tuple

logger = logging.getLogger(__name__)


class TTLCache:
    """In-memory TTL cache. Thread-safe and optionally bounded.

    Entries are stored as ``(value, expires_at)``. ``max_entries`` of ``None``
    disables eviction (backwards-compatible behaviour). When set, the oldest
    entries (by expiry, not insertion) are evicted first.
    """

    def __init__(self, max_entries: Optional[int] = 1000):
        self._store: "OrderedDict[str, tuple]" = OrderedDict()
        self._lock = threading.RLock()
        self._max_entries = max_entries

    # ── Internal helpers (must be called while holding the lock) ────────────
    def _evict_if_needed(self) -> None:
        """Enforce the size cap.

        We deliberately do NOT proactively purge expired entries here, even
        though they're "dead" for ``get``: ``get_stale`` exists so callers
        (e.g. the Yahoo finance fetcher) can fall back to expired data when
        the upstream is down. Evicting them eagerly would break that path.

        When the cap is exceeded we evict the soonest-expiring entries first,
        which keeps the freshest live data resident.
        """
        if self._max_entries is None:
            return
        while len(self._store) > self._max_entries:
            oldest = min(self._store.items(), key=lambda kv: kv[1][1])[0]
            self._store.pop(oldest, None)

    # ── Public API ──────────────────────────────────────────────────────────
    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            if key in self._store:
                value, expires_at = self._store[key]
                if time.time() < expires_at:
                    # Refresh recency so popular keys stay resident.
                    self._store.move_to_end(key)
                    logger.debug("cache HIT  key=%s", key)
                    return value
                logger.debug("cache MISS key=%s (expired)", key)
            else:
                logger.debug("cache MISS key=%s (not found)", key)
        return None

    def get_stale(self, key: str) -> Tuple[Optional[Any], bool]:
        """Return ``(value, is_stale)``. Expired data is returned with a flag."""
        with self._lock:
            if key in self._store:
                value, expires_at = self._store[key]
                now = time.time()
                is_stale = now >= expires_at
                if is_stale:
                    age = int(now - expires_at)
                    logger.warning(
                        "stale cache hit key=%s expired=%ds ago — serving fallback",
                        key, age,
                    )
                return value, is_stale
        return None, True

    def get_or_default(self, key: str, default: Any = None) -> Any:
        result = self.get(key)
        return result if result is not None else default

    def set(self, key: str, value: Any, ttl: int = 60):
        with self._lock:
            self._store[key] = (value, time.time() + ttl)
            self._store.move_to_end(key)
            self._evict_if_needed()

    def clear(self):
        with self._lock:
            self._store.clear()

    def keys(self) -> list:
        with self._lock:
            return list(self._store.keys())

    def size(self) -> int:
        with self._lock:
            return len(self._store)

    def delete(self, key: str):
        with self._lock:
            self._store.pop(key, None)


cache = TTLCache(max_entries=1000)
