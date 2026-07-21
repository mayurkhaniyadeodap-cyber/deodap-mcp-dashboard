"""Per-request performance logging.

Emits one line per API request with: endpoint execution time, summed MCP execution
time, cache hit/miss counts, and the number of MCP tool calls. Per-tool-call
hit/miss lines are logged by mcp_client at DEBUG.

Implemented as a PURE ASGI middleware (not BaseHTTPMiddleware) so it runs in the
SAME async context as the endpoint — the mcp_client per-request stats contextvar
then propagates reliably (BaseHTTPMiddleware runs the app in a separate task, which
can drop contextvar values).
"""

import logging
import time

from app.core.config import settings
from app.services import mcp_client

perf_logger = logging.getLogger("perf")


class PerfMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http" or not scope.get("path", "").startswith(settings.api_prefix):
            await self.app(scope, receive, send)
            return

        stats = mcp_client.begin_request_stats()
        started = time.monotonic()
        status_code = {"v": 0}

        async def _send(message):
            if message["type"] == "http.response.start":
                status_code["v"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            total = time.monotonic() - started
            # Everything that isn't the MCP round-trip: Python transforms + pydantic
            # serialization + framework overhead. (Profiling showed this is tiny —
            # ≤~20ms — so it's reported as one "python" figure rather than split.)
            python_ms = max(0.0, total - stats.mcp_seconds) * 1000
            # endpoint · MCP · python(+serialize) · #calls (real round-trips vs
            # cache/dedup hits — cache hits are the duplicate calls that were avoided).
            perf_logger.info(
                "PERF %s %s -> %s | endpoint=%.2fs mcp=%.2fs python=%.0fms calls=%d (real=%d cache=%d)",
                scope.get("method", ""),
                scope.get("path", ""),
                status_code["v"],
                total,
                stats.mcp_seconds,
                python_ms,
                stats.calls,
                stats.real_calls,
                stats.cache_hits,
            )
