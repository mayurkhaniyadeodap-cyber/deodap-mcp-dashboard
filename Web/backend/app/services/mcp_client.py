"""Client for the live Ship MCP server (Phase 2).

AUTH: the Ship MCP server authenticates via a URL query param
(``?mcp_token=...``), NOT a Bearer header. We build the connect URL as
``{MCP_URL}?mcp_token={MCP_TOKEN}`` and try several transport/auth combos,
stopping at the first success and caching the winner. The token is never logged
(always masked).
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import Any

from mcp.client.session import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamablehttp_client

from app.core.config import settings

logger = logging.getLogger("mcp_client")


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


async def call_tool(name: str, arguments: dict | None = None) -> Any:
    """Call an MCP tool by exact name with the given arguments; return raw result."""
    return await _execute(lambda s: s.call_tool(name, arguments or {}))


async def connection_info() -> dict:
    """Diagnostic: which transport/auth combo connected (token masked)."""
    await _execute(lambda s: s.list_tools())
    return {"connected": True, "transport": _last_transport, "url": _mask(settings.mcp_connect_url)}
