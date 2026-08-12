"""Global bounded MCP concurrency limiter (mcp_client).

These tests exercise the REAL call_tool path (the shared conftest mock replaces
call_tool wholesale, so here we patch the lower-level _execute instead) to prove:
  1. simultaneous REAL round-trips are capped at settings.mcp_max_concurrency, and
  2. cache + single-flight hits return WITHOUT taking a concurrency slot or a round-trip.
No data is changed — the limiter only paces real calls.
"""

import asyncio

from app.core.config import settings
from app.services import mcp_client


def _reset_limiter():
    # Force a fresh per-loop semaphore so a newly-set limit is picked up.
    mcp_client._mcp_semaphores.clear()
    mcp_client.clear_tool_cache()


def test_global_concurrency_cap_bounds_real_calls(monkeypatch):
    monkeypatch.setattr(settings, "mcp_max_concurrency", 3)
    _reset_limiter()

    live = {"cur": 0, "max": 0}

    async def _fake_execute(_operation):
        live["cur"] += 1
        live["max"] = max(live["max"], live["cur"])
        await asyncio.sleep(0.03)  # hold the slot so overlap is observable
        live["cur"] -= 1
        return "ok"

    monkeypatch.setattr(mcp_client, "_execute", _fake_execute)

    async def run():
        # 12 DISTINCT tools => 12 real round-trips, but never more than 3 at once.
        await asyncio.gather(*[mcp_client.call_tool(f"tool_{i}") for i in range(12)])

    asyncio.run(run())
    assert live["max"] == 3, f"peak real concurrency {live['max']} exceeded the cap of 3"


def test_cache_and_single_flight_do_not_consume_a_slot(monkeypatch):
    # Limit of 1: if a cache/single-flight hit wrongly took a slot, 5 identical
    # concurrent calls would serialize into 5 real round-trips. They must not.
    monkeypatch.setattr(settings, "mcp_max_concurrency", 1)
    _reset_limiter()

    real = {"n": 0}

    async def _fake_execute(_operation):
        real["n"] += 1
        await asyncio.sleep(0.02)
        return "ok"

    monkeypatch.setattr(mcp_client, "_execute", _fake_execute)

    async def run():
        stats = mcp_client.begin_request_stats()
        # 5 IDENTICAL concurrent calls -> single-flight collapses to ONE real call.
        await asyncio.gather(*[mcp_client.call_tool("same") for _ in range(5)])
        # 6th identical call -> served from the 60s TTL cache, no round-trip.
        await mcp_client.call_tool("same")
        return stats

    stats = asyncio.run(run())
    assert real["n"] == 1                 # one real round-trip despite 6 requests
    assert stats.calls == 6
    assert stats.real_calls == 1
    assert stats.cache_hits == 5          # 4 single-flight + 1 TTL hit, none took a slot


def test_limiter_preserves_ttl_cache_reuse(monkeypatch):
    monkeypatch.setattr(settings, "mcp_max_concurrency", 6)
    _reset_limiter()

    real = {"n": 0}

    async def _fake_execute(_operation):
        real["n"] += 1
        return {"v": real["n"]}

    monkeypatch.setattr(mcp_client, "_execute", _fake_execute)

    async def run():
        a = await mcp_client.call_tool("t", {"group_by": "courier"})
        b = await mcp_client.call_tool("t", {"group_by": "courier"})  # cache hit
        return a, b

    a, b = asyncio.run(run())
    assert real["n"] == 1     # second call reused the cached result
    assert a is b
