"""Client for the live Ship MCP server (Phase 2).

AUTH: the Ship MCP server authenticates via a URL query param
(``?mcp_token=...``), NOT a Bearer header. We build the connect URL as
``{MCP_URL}?mcp_token={MCP_TOKEN}`` and try several transport/auth combos,
stopping at the first success and caching the winner. The token is never logged
(always masked).
"""

import asyncio
import contextvars
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import Any

from mcp.client.session import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamablehttp_client

from app.core.config import settings

logger = logging.getLogger("mcp_client")
# Dedicated perf logger so timing output can be toggled independently:
#   per-request summary at INFO, per-tool-call hit/miss at DEBUG.
perf_logger = logging.getLogger("perf")


class RequestStats:
    """Per-request MCP counters. A middleware installs one at the start of each
    request (via begin_request_stats); call_tool updates it. Background scheduler
    calls run outside any request → stats is None → they're not counted."""

    __slots__ = ("calls", "cache_hits", "real_calls", "mcp_seconds")

    def __init__(self) -> None:
        self.calls = 0  # total call_tool requests the endpoint made
        self.cache_hits = 0  # served from the TTL cache or single-flight (no MCP round-trip)
        self.real_calls = 0  # actual MCP round-trips
        self.mcp_seconds = 0.0  # summed MCP round-trip time


_request_stats: contextvars.ContextVar[RequestStats | None] = contextvars.ContextVar(
    "mcp_request_stats", default=None
)


def begin_request_stats() -> RequestStats:
    """Start (and return) a fresh per-request stats object; the middleware reads it
    back after the endpoint runs. The returned object is mutated in place, so it's
    visible to the middleware regardless of context-copy semantics."""
    stats = RequestStats()
    _request_stats.set(stats)
    return stats


class MCPUnavailableError(RuntimeError):
    """Raised when no transport/auth combo could reach the MCP server."""


def _mask(text: str) -> str:
    """Mask the token anywhere it appears (URLs, messages) before logging."""
    token = settings.mcp_token
    if token and text and token in text:
        text = text.replace(token, f"{token[:4]}…(masked)")
    return text


def _http_status(exc: Exception) -> str:
    resp = getattr(exc, "response", None)
    code = getattr(resp, "status_code", None)
    return f" (HTTP {code})" if code is not None else ""


# --- Transport/auth strategies, tried in order --------------------------------
# The token is in the URL for all three; strategy 2 additionally sends it as an
# "mcp_token" header (some servers accept either).
def _strategies(url: str, timeout: timedelta) -> list[tuple[str, Callable[[], Any]]]:
    return [
        ("streamable-http (url token)", lambda: streamablehttp_client(url, timeout=timeout)),
        (
            "streamable-http (url token + mcp_token header)",
            lambda: streamablehttp_client(url, headers={"mcp_token": settings.mcp_token}, timeout=timeout),
        ),
        ("sse (url token)", lambda: sse_client(url, timeout=timeout.total_seconds())),
    ]


# Remember which strategy connected so later calls try it first.
_preferred_index: int | None = None
_last_transport: str | None = None


async def _execute(operation: Callable[[ClientSession], Awaitable[Any]]) -> Any:
    """Connect with the first working transport/auth combo and run `operation`.

    Everything (connect → initialize → operation → teardown) happens inside one
    scope so a timeout/cancellation can't leak across a context-manager boundary.
    """
    global _preferred_index, _last_transport

    url = settings.mcp_connect_url
    if not url:
        raise MCPUnavailableError("MCP_URL/MCP_TOKEN not configured")

    timeout = timedelta(seconds=settings.mcp_timeout_seconds)
    strategies = _strategies(url, timeout)
    # Once a transport is known good, try ONLY it — so a failed call fails FAST (one
    # timeout ≈ mcp_timeout_seconds) into the "unavailable" state instead of hanging
    # through every transport (N × timeout). Only the first-ever connect probes all.
    if _preferred_index is not None:
        order = [_preferred_index]
    else:
        order = list(range(len(strategies)))

    errors: list[str] = []
    for i in order:
        label, factory = strategies[i]
        try:
            async with factory() as streams:
                read, write = streams[0], streams[1]
                async with ClientSession(read, write) as session:
                    async with asyncio.timeout(settings.mcp_timeout_seconds):
                        await session.initialize()
                        result = await operation(session)
            _preferred_index = i
            _last_transport = label
            logger.info("MCP connected via %s → %s", label, _mask(url))
            return result
        except Exception as exc:  # noqa: BLE001 — collect and try the next strategy
            msg = f"{label}: {type(exc).__name__}: {_mask(str(exc)) or '(no detail)'}{_http_status(exc)}"
            logger.warning("MCP attempt failed — %s", msg)
            errors.append(msg)

    raise MCPUnavailableError("All MCP transport/auth attempts failed:\n  - " + "\n  - ".join(errors))


async def list_tools() -> list[Any]:
    """Return the MCP server's tool list (name, description, inputSchema)."""
    result = await _execute(lambda s: s.list_tools())
    return list(result.tools)


# --- Tool-result cache + single-flight -----------------------------------------
# The MCP server contends badly under concurrency (a ~5s tool becomes ~18s when
# ~19 calls fire at once — which is exactly what one dashboard page load did,
# because different endpoints each re-requested the SAME tool+args with no shared
# cache). Two safe wins for READ-ONLY analytics, changing NOTHING about the data:
#   1. SINGLE-FLIGHT: concurrent identical calls share one in-flight request, so
#      the page's 3× order_analytics(...) becomes ONE real MCP call.
#   2. TTL CACHE: a completed result is reused for a short window, so a second
#      endpoint (or a quick re-navigation) is an instant hit instead of a fresh
#      slow call. Errors are never cached (a transient outage retries next time).
# Fewer concurrent calls → less server contention → the remaining calls are faster
# too. The cached result object is only ever read (parse_tool_json), never mutated.
_TOOL_CACHE_TTL = 60.0
_TOOL_CACHE_MAX = 256
_tool_cache: dict[tuple, tuple[float, Any]] = {}
_tool_inflight: dict[tuple, "asyncio.Future[Any]"] = {}


def _tool_key(name: str, arguments: dict) -> tuple:
    # args are flat scalars (str/int/bool) → hashable and order-independent.
    return (name, tuple(sorted(arguments.items())))


def clear_tool_cache() -> None:
    """Drop all cached tool results (used by tests / a manual refresh)."""
    _tool_cache.clear()


async def call_tool(name: str, arguments: dict | None = None) -> Any:
    """Call an MCP tool by exact name; return raw result. De-duplicated via a
    single-flight in-flight map + a short TTL result cache (see above)."""
    arguments = arguments or {}
    key = _tool_key(name, arguments)
    now = time.monotonic()
    stats = _request_stats.get()
    if stats is not None:
        stats.calls += 1

    hit = _tool_cache.get(key)
    if hit is not None and (now - hit[0]) < _TOOL_CACHE_TTL:
        if stats is not None:
            stats.cache_hits += 1
        perf_logger.debug("mcp %-28s cache HIT", name)
        return hit[1]

    inflight = _tool_inflight.get(key)
    if inflight is not None:
        if stats is not None:  # deduped by single-flight → no MCP round-trip
            stats.cache_hits += 1
        perf_logger.debug("mcp %-28s single-flight HIT", name)
        return await inflight  # an identical call is already running — await it

    loop = asyncio.get_running_loop()
    fut: "asyncio.Future[Any]" = loop.create_future()
    _tool_inflight[key] = fut
    call_started = time.monotonic()
    try:
        result = await _execute(lambda s: s.call_tool(name, arguments))
    except Exception as exc:  # noqa: BLE001 — never cache failures
        if not fut.done():
            fut.set_exception(exc)
        raise
    finally:
        _tool_inflight.pop(key, None)

    elapsed = time.monotonic() - call_started
    if stats is not None:
        stats.real_calls += 1
        stats.mcp_seconds += elapsed
    perf_logger.debug("mcp %-28s MISS %6.2fs", name, elapsed)

    if len(_tool_cache) >= _TOOL_CACHE_MAX:  # bound — evict expired first…
        for k, (ts, _) in list(_tool_cache.items()):
            if (now - ts) >= _TOOL_CACHE_TTL:
                _tool_cache.pop(k, None)
        # …then, if still at cap (all entries unexpired), drop the oldest so the cap
        # is a HARD bound, not just best-effort.
        if len(_tool_cache) >= _TOOL_CACHE_MAX:
            _tool_cache.pop(min(_tool_cache, key=lambda k: _tool_cache[k][0]), None)
    _tool_cache[key] = (now, result)
    if not fut.done():
        fut.set_result(result)
    return result


async def connection_info() -> dict:
    """Diagnostic: which transport/auth combo connected (token masked)."""
    await _execute(lambda s: s.list_tools())
    return {"connected": True, "transport": _last_transport, "url": _mask(settings.mcp_connect_url)}
