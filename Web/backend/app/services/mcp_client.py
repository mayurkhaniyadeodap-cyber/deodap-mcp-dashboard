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
import weakref
from collections.abc import Awaitable, Callable, Iterator
from contextlib import asynccontextmanager, contextmanager, nullcontext
from datetime import timedelta
from typing import Any

import httpx
from mcp.client.session import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamable_http_client

from app.core.config import settings


# MCP SDK transport compatibility -------------------------------------------------
# The native streaming client is `streamable_http_client(url, *, http_client=None,
# terminate_on_close=True)` — it accepts NEITHER `headers` NOR `timeout`; those lived
# only on the old `streamablehttp_client` alias, which mcp 2.x removed. `_strategies()`
# below still calls with the legacy `headers=`/`timeout=` signature, so we keep a thin
# wrapper of that exact name + signature and adapt it to the native API. Because
# `streamable_http_client` exists on BOTH the SDK we run locally (1.x) and the one in
# production (2.0.0), this single path runs identically in both — no version-divergent
# branch that could pass locally yet fail in prod (the previous failure mode).
#
# Auth is the URL query token (?mcp_token=...), so:
#   - no-header path → call the native client directly; the SDK builds its own client
#     with recommended MCP timeouts. This is the exact call verified working against
#     the live server, so it is the PRIMARY streamable-HTTP transport.
#   - header path → carry the header (+ timeout) on a plain httpx.AsyncClient passed
#     via `http_client=` (the SDK-documented way to customise HTTP). We deliberately do
#     NOT use `create_mcp_http_client(headers=…, timeout=…)`: that call is what raised
#     the ExceptionGroup/TaskGroup under mcp 2.0.0. `httpx.AsyncClient(follow_redirects
#     =True, timeout=…, headers=…)` reproduces exactly what that factory built.
@asynccontextmanager
async def streamablehttp_client(
    url: str,
    headers: dict[str, str] | None = None,
    timeout: float | timedelta = 30,
    sse_read_timeout: float | timedelta = 60 * 5,
    terminate_on_close: bool = True,
):
    if not headers:
        # PRIMARY transport (URL-token auth) — native call, SDK-managed client.
        async with streamable_http_client(url, terminate_on_close=terminate_on_close) as streams:
            yield streams
        return
    # Header-auth fallback: a plain httpx client carries the header + timeouts.
    timeout_seconds = timeout.total_seconds() if isinstance(timeout, timedelta) else timeout
    sse_read_timeout_seconds = (
        sse_read_timeout.total_seconds() if isinstance(sse_read_timeout, timedelta) else sse_read_timeout
    )
    client = httpx.AsyncClient(
        headers=headers,
        timeout=httpx.Timeout(timeout_seconds, read=sse_read_timeout_seconds),
        follow_redirects=True,
    )
    async with client:
        async with streamable_http_client(
            url, http_client=client, terminate_on_close=terminate_on_close
        ) as streams:
            yield streams

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
        text = text.replace(token, "(masked)")  # no part of the token is ever shown
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

    timeout_seconds = _effective_timeout()
    timeout = timedelta(seconds=timeout_seconds)
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
        connected = False
        try:
            async with factory() as streams:
                read, write = streams[0], streams[1]
                async with ClientSession(read, write) as session:
                    async with asyncio.timeout(timeout_seconds):
                        await session.initialize()
                        # Connection + handshake proven good on THIS transport. Cache it
                        # NOW — before running the operation — so that (a) every later
                        # call skips straight to it instead of re-probing all strategies,
                        # and (b) a failure below (e.g. a slow tool hitting the timeout)
                        # is treated as a TOOL failure, not a transport failure.
                        connected = True
                        if _preferred_index != i:
                            _preferred_index = i
                            _last_transport = label
                            logger.info("MCP connected via %s → %s", label, _mask(url))
                        result = await operation(session)
            return result
        except Exception as exc:  # noqa: BLE001
            msg = f"{label}: {type(exc).__name__}: {_mask(str(exc)) or '(no detail)'}{_http_status(exc)}"
            logger.warning("MCP attempt failed — %s", msg)
            errors.append(msg)
            # The transport connected fine — the failure is the tool call itself (a slow
            # tool timing out, or a tool error). Trying the OTHER transports would just
            # hit the same tool and burn another timeout each, so surface it now instead
            # of amplifying the delay (this is the failure-amplification fix).
            if connected:
                raise

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
_tool_inflight_started: dict[tuple, float] = {}  # key -> monotonic start of the in-flight call

# --- Forced fresh reads (full refresh: "Fetch Data Now" / automatic refresh) -----
# Inside `fresh_results(since)`, a cached tool result (or an in-flight call) that
# STARTED before `since` is not reused — the call goes to the MCP again. Results
# fetched after `since` ARE reused, so one refresh that needs the same tool+args for
# several datasets still makes ONE round-trip (cache + single-flight preserved), and
# every real call still takes a slot from the global concurrency limit. The fresh
# result is stored in the normal cache, so it also serves ordinary requests.
# A contextvar (not a parameter) so every service reaches it unchanged: asyncio
# copies the context into the tasks that gather() creates.
_fresh_since: contextvars.ContextVar[float | None] = contextvars.ContextVar(
    "mcp_fresh_since", default=None
)


def _next_tick() -> float:
    """A monotonic instant strictly AFTER every timestamp already stored. The
    monotonic clock is coarse on Windows (~16ms ticks), so a value cached in the
    current tick would otherwise compare equal to the cut-off and count as fresh.
    Waits at most one tick (instant on Linux, where the clock is fine-grained)."""
    first = now = time.monotonic()
    while now == first:
        now = time.monotonic()
    return now


# Start of the most recent forced refresh (any task). Lets cache_stamp() tell whether
# a refresh began while a fetch was in flight.
_latest_fresh_start: float = float("-inf")


def cache_stamp(started: float) -> float:
    """Timestamp to store with a result whose fetch began at `started`.

    The FINISH time, so a cache TTL counts from when the data arrived — stamping the
    start made any fetch slower than the TTL (common when the MCP is busy) land in the
    cache already expired, so the next page visit fetched it all over again. Exception:
    if a forced refresh began mid-fetch, keep the start time, so that refresh still
    sees the result as older than its cut-off and fetches fresh data."""
    if _latest_fresh_start > started:
        return started
    return time.monotonic()


@contextmanager
def fresh_results(since: float | None = None) -> Iterator[float]:
    """Force fresh MCP reads for results older than `since` (monotonic; default now)."""
    global _latest_fresh_start
    started = _next_tick() if since is None else since
    _latest_fresh_start = max(_latest_fresh_start, started)
    token = _fresh_since.set(started)
    try:
        yield started
    finally:
        _fresh_since.reset(token)


def fresh_since() -> float | None:
    """The active forced-refresh cut-off, or None outside a refresh."""
    return _fresh_since.get()


# --- Per-call timeout override (background work) ---------------------------------
# Background jobs nobody waits on (full refresh, warm-cache rebuilds) may give slow
# tools longer than the request-path MCP_TIMEOUT_SECONDS. Contextvar for the same
# reason as above: every service reaches it unchanged.
_call_timeout: contextvars.ContextVar[float | None] = contextvars.ContextVar(
    "mcp_call_timeout", default=None
)


@contextmanager
def call_timeout(seconds: float) -> Iterator[None]:
    """Use `seconds` as the per-call MCP timeout for calls made inside this block."""
    token = _call_timeout.set(seconds)
    try:
        yield
    finally:
        _call_timeout.reset(token)


def _effective_timeout() -> float:
    return _call_timeout.get() or settings.mcp_timeout_seconds


# --- Background lane ----------------------------------------------------------------
# Work no user is waiting on (full refresh, warm-cache rebuilds — both run under
# call_timeout/fresh_results — and anything inside low_priority(), e.g. the KPI
# sparklines) shares at most MCP_BACKGROUND_MAX_CONCURRENCY of the global slots, so
# a page opened mid-refresh is never queued behind ~100 background round-trips.
_low_priority: contextvars.ContextVar[bool] = contextvars.ContextVar("mcp_low_priority", default=False)


@contextmanager
def low_priority() -> Iterator[None]:
    """Run the MCP calls made inside this block in the background lane."""
    token = _low_priority.set(True)
    try:
        yield
    finally:
        _low_priority.reset(token)


def _is_background() -> bool:
    return _low_priority.get() or _call_timeout.get() is not None or _fresh_since.get() is not None

# --- Global bounded concurrency for REAL MCP round-trips -----------------------
# 3. CONCURRENCY CAP: only ACTUAL round-trips take a slot (cache + single-flight
#    hits already returned before we get here, so they never consume one). Bounding
#    total simultaneous round-trips stops a Retry — which fires every page query at
#    once — from saturating the upstream and triggering the 5s→18s contention above.
#    This paces calls; it NEVER drops, skips, samples, or reorders data, and the
#    12s timeout + unavailable fallback still apply to each slotted call unchanged.
# The semaphore is created lazily per running event loop (keyed weakly) so it binds
# to the correct loop — one shared limiter in production, isolated per test loop.
_mcp_semaphores: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = (
    weakref.WeakKeyDictionary()
)


def _mcp_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    sem = _mcp_semaphores.get(loop)
    if sem is None:
        sem = asyncio.Semaphore(max(1, settings.mcp_max_concurrency))
        _mcp_semaphores[loop] = sem
    return sem


_bg_semaphores: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = (
    weakref.WeakKeyDictionary()
)


def _bg_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    sem = _bg_semaphores.get(loop)
    if sem is None:
        cap = max(1, settings.mcp_max_concurrency)
        sem = asyncio.Semaphore(min(cap, max(1, settings.mcp_background_max_concurrency)))
        _bg_semaphores[loop] = sem
    return sem


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
    since = _fresh_since.get()
    stats = _request_stats.get()
    if stats is not None:
        stats.calls += 1

    retried_joined = False
    while True:
        now = time.monotonic()
        hit = _tool_cache.get(key)
        if hit is not None and (now - hit[0]) < _TOOL_CACHE_TTL and (since is None or hit[0] >= since):
            if stats is not None:
                stats.cache_hits += 1
            perf_logger.debug("mcp %-28s cache HIT", name)
            return hit[1]

        inflight = _tool_inflight.get(key)
        if inflight is None:
            break
        if since is None or _tool_inflight_started.get(key, now) >= since:
            if stats is not None:  # deduped by single-flight → no MCP round-trip
                stats.cache_hits += 1
            perf_logger.debug("mcp %-28s single-flight HIT", name)
            if since is None:
                return await inflight  # an identical call is already running — await it
            try:
                return await inflight
            except Exception:  # noqa: BLE001
                # Forced refresh joined a call that failed — e.g. a page request made
                # during the refresh, which has the shorter request timeout. Retry
                # ONCE with our own call (that call has ended, so no duplicate runs).
                if retried_joined:
                    raise
                retried_joined = True
                continue
        # Forced refresh: the running identical call started BEFORE the refresh, so
        # its data may predate it. Let it finish (never two identical round-trips at
        # once), then look again — its result is too old, so we make our own call.
        try:
            await inflight
        except Exception:  # noqa: BLE001 — its failure is its caller's; we retry fresh
            pass

    loop = asyncio.get_running_loop()
    fut: "asyncio.Future[Any]" = loop.create_future()
    # Register inflight BEFORE awaiting the concurrency slot: identical calls that
    # arrive while we're queued single-flight onto this future (a cache hit, no slot)
    # instead of stacking up their own real round-trips behind the semaphore.
    _tool_inflight[key] = fut
    _tool_inflight_started[key] = now
    try:
        # Take a global slot only for the REAL round-trip. Time only the round-trip
        # (started after acquiring) so mcp_seconds stays "pure MCP time" — directly
        # comparable before/after this change; queue wait shows up in endpoint time.
        # Background work first takes a background-lane slot, so it can never hold
        # every global slot (pages always have some free).
        async with (_bg_semaphore() if _is_background() else nullcontext()):
            async with _mcp_semaphore():
                call_started = time.monotonic()
                result = await _execute(lambda s: s.call_tool(name, arguments))
                elapsed = time.monotonic() - call_started
    except Exception as exc:  # noqa: BLE001 — never cache failures
        if not fut.done():
            fut.set_exception(exc)
        raise
    finally:
        _tool_inflight.pop(key, None)
        _tool_inflight_started.pop(key, None)

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
    _tool_cache[key] = (cache_stamp(now), result)
    if not fut.done():
        fut.set_result(result)
    return result


async def connection_info() -> dict:
    """Diagnostic: which transport/auth combo connected (token masked)."""
    await _execute(lambda s: s.list_tools())
    return {"connected": True, "transport": _last_transport, "url": _mask(settings.mcp_connect_url)}
