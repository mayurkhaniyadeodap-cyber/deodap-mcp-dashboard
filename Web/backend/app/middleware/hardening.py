"""Security hardening middleware (Phase 5, additive).

  SecurityHeadersMiddleware — adds CSP / HSTS / X-Frame-Options / X-Content-Type-
    Options / Referrer-Policy / Permissions-Policy to every response.
  RateLimitMiddleware — in-memory sliding-window limiter for sensitive route
    classes (login / admin / export / debug). Returns 429 when exceeded.

Both are PURE ASGI (like PerfMiddleware) so they never disturb the per-request MCP
stats contextvar. Neither touches business logic, MCP, caches, or existing
response bodies — they only add headers / gate abusive request rates.
"""

import json
import time
from collections import deque

from app.core.config import settings


class SecurityHeadersMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http" or not settings.security_headers_enabled:
            await self.app(scope, receive, send)
            return

        headers = [
            (b"content-security-policy", settings.content_security_policy.encode("latin-1")),
            (b"strict-transport-security", f"max-age={settings.hsts_max_age_seconds}; includeSubDomains".encode("latin-1")),
            (b"x-frame-options", b"DENY"),
            (b"x-content-type-options", b"nosniff"),
            (b"referrer-policy", b"strict-origin-when-cross-origin"),
            (b"permissions-policy", b"geolocation=(), microphone=(), camera=()"),
        ]

        async def _send(message):
            if message["type"] == "http.response.start":
                existing = {k.lower() for k, _ in message.setdefault("headers", [])}
                for k, v in headers:
                    if k not in existing:  # never clobber a header the app already set
                        message["headers"].append((k, v))
            await send(message)

        await self.app(scope, receive, _send)


# --- Rate limiting --------------------------------------------------------------
# (method_prefix | None, path_prefix, bucket, limit, window_seconds). First match
# wins; endpoints not matched are NOT limited (dashboard traffic is untouched).
_RULES: list[tuple[str | None, str, str, int, int]] = [
    ("POST", "/api/login", "login", 10, 60),      # brute-force guard
    (None, "/api/users", "admin", 60, 60),
    (None, "/api/_status/schedulers", "admin", 60, 60),
    (None, "/api/_status/metrics", "admin", 60, 60),
    (None, "/api/export", "export", 30, 60),
    (None, "/api/_mcp", "debug", 30, 60),
]

# {(bucket, client): deque[timestamps]}. In-process (single worker); soft-capped.
_hits: dict[tuple, deque] = {}
_MAX_KEYS = 10_000


def reset_rate_limits() -> None:
    """Clear the limiter state (used by tests)."""
    _hits.clear()


def _client_ip(scope) -> str:
    # Honour X-Forwarded-For (app sits behind a reverse proxy), else the socket peer.
    for k, v in scope.get("headers", []):
        if k == b"x-forwarded-for":
            return v.decode("latin-1").split(",")[0].strip()
    client = scope.get("client")
    return client[0] if client else "unknown"


def _match(method: str, path: str) -> tuple[str, int, int] | None:
    for m, prefix, bucket, limit, window in _RULES:
        if (m is None or m == method) and path.startswith(prefix):
            return bucket, limit, window
    return None


class RateLimitMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http" or not settings.rate_limit_enabled:
            await self.app(scope, receive, send)
            return

        rule = _match(scope.get("method", ""), scope.get("path", ""))
        if rule is None:
            await self.app(scope, receive, send)
            return

        bucket, limit, window = rule
        key = (bucket, _client_ip(scope))
        now = time.monotonic()
        dq = _hits.get(key)
        if dq is None:
            if len(_hits) >= _MAX_KEYS:  # soft bound: drop everything rather than grow unbounded
                _hits.clear()
            dq = _hits[key] = deque()
        while dq and now - dq[0] > window:
            dq.popleft()

        if len(dq) >= limit:
            retry = int(window - (now - dq[0])) + 1
            body = json.dumps({"error": {"message": "Rate limit exceeded. Please retry later."}}).encode()
            await send({
                "type": "http.response.start",
                "status": 429,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"retry-after", str(retry).encode("latin-1")),
                ],
            })
            await send({"type": "http.response.body", "body": body})
            return

        dq.append(now)
        await self.app(scope, receive, send)
