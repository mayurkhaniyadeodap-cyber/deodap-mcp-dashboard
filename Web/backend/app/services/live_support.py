"""Shared helpers for wiring a mock endpoint to the live Ship MCP server.

Every endpoint reuses the same pattern as /api/couriers:
  - per-(from,to) 60s cache,
  - async fetch from MCP,
  - on ANY error / blank MCP token / unusable result → log a warning and return
    the endpoint's existing mock (response shape stays byte-identical).
"""

import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from app.core.config import settings

logger = logging.getLogger("live")

T = TypeVar("T")

CACHE_TTL_SECONDS = 60.0


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
        logger.warning("%s: Ship MCP not configured — using sample data.", label)
        return mock()

    try:
        result = await fetch()
        if result is None:
            raise ValueError("live fetch returned nothing usable")
        cache[key] = (now, result)
        logger.info("%s: served LIVE from MCP (from=%s to=%s)", label, key[0], key[1])
        return result
    except Exception as exc:  # noqa: BLE001 — never break the app
        # Concise one-line warning only — never a stack trace for an expected fallback.
        logger.warning("%s: Ship MCP unavailable (%s) — using sample data.", label, exc)
        return mock()


def date_args(date_from: str | None, date_to: str | None) -> dict:
    """Map the frontend from/to to the Ship tools' `from`/`to` params (absent → server default)."""
    args: dict = {}
    if date_from:
        args["from"] = date_from
    if date_to:
        args["to"] = date_to
    return args
