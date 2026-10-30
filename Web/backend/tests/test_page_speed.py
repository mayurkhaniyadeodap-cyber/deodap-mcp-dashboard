"""Page-load speed fixes (mcp_client + live_support).

1. Cache stamping: a result is stamped when its fetch FINISHES, so a fetch slower than
   the cache TTL is still served from cache on the next visit (it used to be stored
   with its start time and was already expired). A forced refresh that began
   mid-fetch still treats that result as old (fresh-data guarantee kept).
2. Background lane: refresh / warm-cache / sparkline calls use at most
   MCP_BACKGROUND_MAX_CONCURRENCY of the global slots, so a page's own calls are
   never queued behind them.
The real call_tool path runs; only the lower-level _execute is faked.
"""

import asyncio
import time

from app.core.config import settings
from app.services import live_support, mcp_client


def _reset():
    mcp_client._mcp_semaphores.clear()
    mcp_client._bg_semaphores.clear()
    mcp_client.clear_tool_cache()


def test_slow_fetch_is_still_cached_for_the_next_visit(monkeypatch):
    monkeypatch.setattr(live_support, "CACHE_TTL_SECONDS", 0.2)
    fetches = {"n": 0}
    cache: dict = {}

    async def slow_fetch():
        fetches["n"] += 1
        await asyncio.sleep(0.3)  # slower than the TTL
        return {"v": fetches["n"]}

    async def run():
        first = await live_support.live_or_mock(cache=cache, key=("2026-09-01", "2026-09-30"), label="t", fetch=slow_fetch, mock=dict)
        again = await live_support.live_or_mock(cache=cache, key=("2026-09-01", "2026-09-30"), label="t", fetch=slow_fetch, mock=dict)
        return first, again

    first, again = asyncio.run(run())
    assert fetches["n"] == 1, "the second visit refetched a result that had only just arrived"
    assert again is first


def test_refresh_started_mid_fetch_keeps_the_start_stamp():
    started = time.monotonic()
    with mcp_client.fresh_results():  # a refresh begins while that fetch is in flight
        pass
    assert mcp_client.cache_stamp(started) == started  # → the refresh will refetch it
    later = time.monotonic()
    assert mcp_client.cache_stamp(later) >= later  # no refresh since → finish time


def test_background_work_leaves_slots_for_page_calls(monkeypatch):
    monkeypatch.setattr(settings, "mcp_max_concurrency", 4)
    monkeypatch.setattr(settings, "mcp_background_max_concurrency", 2)
    _reset()
    live = {"bg": 0, "bg_max": 0}
    page_waited: list[float] = []

    async def _fake_execute(_operation):
        await asyncio.sleep(0.05)
        return "ok"

    monkeypatch.setattr(mcp_client, "_execute", _fake_execute)

    async def bg_call(i):
        with mcp_client.low_priority():
            live["bg"] += 1
            live["bg_max"] = max(live["bg_max"], live["bg"])
            try:
                return await mcp_client.call_tool(f"bg_{i}")
            finally:
                live["bg"] -= 1

    async def page_call():
        await asyncio.sleep(0.01)  # background burst is already queued
        t = time.monotonic()
        await mcp_client.call_tool("page_tool")
        page_waited.append(time.monotonic() - t)

    async def run():
        await asyncio.gather(*[bg_call(i) for i in range(10)], page_call())

    asyncio.run(run())
    # The page call got a free slot at once (one round-trip ≈ 0.05s), instead of
    # waiting behind 10 background calls (≈ 0.25s+ at 2 at a time).
    assert page_waited[0] < 0.12


def test_background_lane_caps_simultaneous_background_round_trips(monkeypatch):
    monkeypatch.setattr(settings, "mcp_max_concurrency", 6)
    monkeypatch.setattr(settings, "mcp_background_max_concurrency", 3)
    _reset()
    live = {"cur": 0, "max": 0}

    async def _fake_execute(_operation):
        live["cur"] += 1
        live["max"] = max(live["max"], live["cur"])
        await asyncio.sleep(0.03)
        live["cur"] -= 1
        return "ok"

    monkeypatch.setattr(mcp_client, "_execute", _fake_execute)

    async def run():
        with mcp_client.call_timeout(180):  # how the refresh / warm jobs run
            await asyncio.gather(*[mcp_client.call_tool(f"t_{i}") for i in range(12)])

    asyncio.run(run())
    assert live["max"] == 3


def test_prefetch_header_runs_the_request_in_the_background_lane(client, monkeypatch):
    seen: list[bool] = []

    async def _call(name, arguments=None):
        seen.append((mcp_client._is_background(), mcp_client._effective_timeout()))
        raise RuntimeError("MCP down (test)")  # the lane is all we check

    monkeypatch.setattr("app.services.mcp_client.call_tool", _call)
    client.get("/api/zones", params={"from": "2026-09-01", "to": "2026-09-30"}, headers={"X-Prefetch": "1"})
    client.get("/api/weight", params={"from": "2026-09-01", "to": "2026-09-30"})
    assert seen[0] == (True, settings.background_mcp_timeout_seconds)  # prefetch: bg lane, long timeout
    assert seen[-1] == (False, settings.mcp_timeout_seconds)  # a page request: full priority, 30s
