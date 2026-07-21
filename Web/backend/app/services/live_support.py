"""Shared helpers for wiring a mock endpoint to the live Ship MCP server.

Every endpoint reuses the same pattern as /api/couriers:
  - per-(from,to) 60s cache,
  - async fetch from MCP,
  - on ANY error / blank MCP token / unusable result → log a warning and return
    the endpoint's existing mock (response shape stays byte-identical).
"""

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from app.core.config import settings

logger = logging.getLogger("live")

T = TypeVar("T")

CACHE_TTL_SECONDS = 60.0

# Shared cap across ALL heavy background enumerations (claimable, dispute-lines,
# recovery). Only ONE runs at a time, so the schedulers can't collectively saturate
# the (session-per-request) upstream MCP — total background concurrency stays bounded
# by whichever single job is running (each is itself page-concurrency-capped ≤4).
background_job_sem = asyncio.Semaphore(1)


class inflight_guard:
    """Async context manager that de-duplicates concurrent work on the same key.
    Registers `key` in `registry` (a set); yields True to the winner and False if a
    job for that key is already running (so the caller can bail without re-doing it).
    Used by the warm-cache refreshers so a burst of stale requests spawns ONE refresh
    per key instead of many that serialize on the shared background semaphore."""

    def __init__(self, registry: set, key) -> None:
        self._registry = registry
        self._key = key
        self.acquired = False

    async def __aenter__(self) -> bool:
        if self._key in self._registry:
            self.acquired = False
        else:
            self._registry.add(self._key)
            self.acquired = True
        return self.acquired

    async def __aexit__(self, *exc) -> None:
        if self.acquired:
            self._registry.discard(self._key)


def prune_cache(cache: dict, max_entries: int) -> None:
    """Bound a warm/TTL cache: if it exceeds `max_entries`, evict the OLDEST entries
    (by the stored monotonic timestamp at value[0]). Keeps per-window warm stores
    from growing unbounded as users pick many date ranges."""
    over = len(cache) - max_entries
    if over > 0:
        for k in sorted(cache, key=lambda k: cache[k][0])[:over]:
            cache.pop(k, None)


def new_cache() -> dict:
    """A fresh per-service cache: {(from, to): (monotonic_ts, value)}."""
    return {}


def parse_tool_json(result: Any) -> dict:
    """Extract the JSON payload from an MCP CallToolResult (text content block)."""
    for block in getattr(result, "content", []) or []:
        if getattr(block, "type", None) == "text":
            return json.loads(block.text)
    structured = getattr(result, "structuredContent", None)
    if structured:
        return structured
    raise ValueError("MCP tool returned no JSON content")


async def live_or_mock(
    *,
    cache: dict,
    key: tuple,
    label: str,
    fetch: Callable[[], Awaitable[T]],
    mock: Callable[[], T],
) -> T:
    """Return a cached/live result for `key`, falling back to `mock()` on failure."""
    now = time.monotonic()
    cached = cache.get(key)
    if cached is not None and (now - cached[0]) < CACHE_TTL_SECONDS:
        return cached[1]

    if not settings.mcp_connect_url:
        logger.error("%s: Ship MCP not configured — serving 'data unavailable' (no fixtures).", label)
        return mock()

    try:
        result = await fetch()
        if result is None:
            raise ValueError("live fetch returned nothing usable")
        cache[key] = (now, result)
        logger.info("%s: served LIVE from MCP (from=%s to=%s)", label, key[0], key[1])
        return result
    except Exception as exc:  # noqa: BLE001 — never break the app
        # Log the REAL exception at ERROR so an outage can't hide behind a quiet
        # fixture. The fallback (mock callable) returns the honest "unavailable"
        # state by default — fixtures only when USE_MOCK_FALLBACK is on (dev).
        logger.error("%s: Ship MCP unavailable — serving 'data unavailable'. Cause: %r", label, exc)
        return mock()


def date_args(date_from: str | None, date_to: str | None) -> dict:
    """Map the frontend from/to to the Ship tools' `from`/`to` params (absent → server default)."""
    args: dict = {}
    if date_from:
        args["from"] = date_from
    if date_to:
        args["to"] = date_to
    return args
