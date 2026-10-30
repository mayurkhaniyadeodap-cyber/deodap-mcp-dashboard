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
from datetime import UTC, datetime, timedelta
from typing import Any, TypeVar

from app.core.config import settings
from app.services import mcp_client

logger = logging.getLogger("live")

# --- Data-fetch trace log ----------------------------------------------------------
# One INFO line per dataset served or fetched, so it is visible WHERE each number came
# from: the requested date range, whether it was a live Ship MCP fetch or a cache hit,
# and when the data was actually fetched from the MCP. Its own logger + handler (the
# app has no logging config, so other INFO logs are not printed by uvicorn).
fetch_logger = logging.getLogger("datafetch")


def configure_fetch_logging() -> None:
    """Print the data-fetch trace at INFO (idempotent; called once at app import)."""
    if not any(getattr(h, "_datafetch", False) for h in fetch_logger.handlers):
        handler = logging.StreamHandler()
        handler._datafetch = True  # type: ignore[attr-defined]
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s datafetch: %(message)s"))
        fetch_logger.addHandler(handler)
    fetch_logger.setLevel(logging.INFO)


def _wall_clock(monotonic_ts: float) -> str:
    """Wall-clock UTC time of a cache entry's monotonic timestamp."""
    ago = max(0.0, time.monotonic() - monotonic_ts)
    return (datetime.now(UTC) - timedelta(seconds=ago)).isoformat(timespec="seconds")


def rebuild_mode() -> str:
    """Who triggered a warm-cache rebuild: a full refresh, or a background scheduler."""
    return "refresh" if mcp_client.fresh_since() is not None else "background"


def log_fetch(dataset: str, key: tuple, source: str, stored_at: float | None = None,
              mode: str | None = None, detail: str = "") -> None:
    """Trace one dataset: `source` is live-mcp (fetched now), cache / warm-cache (an
    earlier fetch, with its age), or unavailable/failed. `mode`: page (a GET), refresh
    (Fetch Data Now / automatic refresh) or background (a warm-cache scheduler)."""
    if mode is None:
        mode = "refresh" if mcp_client.fresh_since() is not None else "page"
    when = ""
    if stored_at is not None:
        when = f" fetched_at={_wall_clock(stored_at)} age={max(0.0, time.monotonic() - stored_at):.0f}s"
    fetch_logger.info("dataset=%s range=%s..%s source=%s%s mode=%s%s", dataset, key[0], key[1],
                      source, when, mode, f" {detail}" if detail else "")

T = TypeVar("T")

CACHE_TTL_SECONDS = 60.0

# Shared cap across ALL heavy background enumerations (claimable, dispute-lines,
# recovery). Only ONE runs at a time, so the schedulers can't collectively saturate
# the (session-per-request) upstream MCP — total background concurrency stays bounded
# by whichever single job is running (each is itself page-concurrency-capped ≤4).
background_job_sem = asyncio.Semaphore(1)


def background_timeout():
    """Context manager: the longer per-call MCP timeout for background work that no
    request waits on (warm-cache rebuilds, full refresh) — see config."""
    return mcp_client.call_timeout(settings.background_mcp_timeout_seconds)


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


# Last failure of each warm-cache rebuild: {(label, key): (monotonic_ts, message)}.
# The warm refreshers swallow errors (a scheduler must never crash and the last good
# value must stay), so this is how a full refresh learns WHY a rebuild failed.
warm_failures: dict[tuple, tuple[float, str]] = {}


def note_warm_failure(label: str, key: tuple, exc: BaseException) -> None:
    warm_failures[(label, key)] = (time.monotonic(), describe_error(exc))
    prune_cache(warm_failures, 64)


def describe_error(exc: BaseException) -> str:
    """Short, readable cause for the UI. The MCP SDK wraps failures in nested
    TaskGroup ExceptionGroups ("unhandled errors in a TaskGroup"), so unwrap to the
    real error first. Callers must still mask the MCP token (mcp_client._mask)."""
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    if isinstance(exc, TimeoutError):
        return f"Ship MCP call timed out (>{settings.mcp_timeout_seconds:.0f}s)"
    text = str(exc)
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__


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
    """Return a cached/live result for `key`, falling back to `mock()` on failure.

    Inside a full refresh (mcp_client.fresh_results) a cached value from before the
    refresh is not reused, and a failure RAISES instead of serving the fallback — the
    refresh reports it and the last good cached value is left untouched."""
    now = time.monotonic()
    since = mcp_client.fresh_since()
    cached = cache.get(key)
    if cached is not None and (now - cached[0]) < CACHE_TTL_SECONDS and (since is None or cached[0] >= since):
        log_fetch(label, key, "cache", cached[0])
        return cached[1]

    if not settings.mcp_connect_url:
        log_fetch(label, key, "unavailable", detail="(MCP not configured)")
        if since is not None:
            raise mcp_client.MCPUnavailableError("MCP_URL/MCP_TOKEN not configured")
        logger.error("%s: Ship MCP not configured — serving 'data unavailable' (no fixtures).", label)
        return mock()

    try:
        result = await fetch()
        if result is None:
            raise ValueError("live fetch returned nothing usable")
        cache[key] = (mcp_client.cache_stamp(now), result)
        log_fetch(label, key, "live-mcp", now, detail=f"took={time.monotonic() - now:.1f}s")
        return result
    except Exception as exc:  # noqa: BLE001 — never break the app
        log_fetch(label, key, "failed" if since is not None else "unavailable",
                  detail=f"cause={describe_error(exc)!r}")
        if since is not None:
            logger.error("%s: refresh fetch failed — keeping last good value. Cause: %r", label, exc)
            raise
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


def rate_pct(count: int, orders: int) -> float:
    """Percentage of `orders` that are `count` — the shared RTO/NDR rate formula
    (rto_analysis/ndr_analysis count ÷ order_analytics orders × 100, rounded 2dp).
    0.0 when there are no orders. Extracted from courier/discrepancy/savings
    services verbatim — no calculation/rounding change."""
    return round(count / orders * 100, 2) if orders else 0.0


def scheduler_snapshot(name: str, cadence_seconds: int, warm: dict, key: tuple) -> dict:
    """READ-ONLY warm-cache/scheduler telemetry for one background scheduler.

    Reads a service's existing warm store + primary key — it never mutates state,
    starts no timer, and does not change scheduler behavior. Warm timestamps are
    time.monotonic() (not wall-clock), so we report AGE, not an absolute time:
      cache_age_seconds     = now − last stored (≈ time since last refresh)
      next_refresh_seconds  = cadence − age (until the next scheduled refresh)
    Both are None when the primary window has never been warmed yet."""
    hit = warm.get(key)
    age = (time.monotonic() - hit[0]) if hit else None
    return {
        "name": name,
        "cadence_seconds": cadence_seconds,
        "running": bool(settings.mcp_connect_url),
        "warm": hit is not None,
        "cache_age_seconds": round(age, 1) if age is not None else None,
        "next_refresh_seconds": round(max(0.0, cadence_seconds - age), 1) if age is not None else None,
    }
