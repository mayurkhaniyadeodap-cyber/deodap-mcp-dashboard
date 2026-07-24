"""FastAPI application entrypoint.

Checkpoint 1: boots with CORS, request-id, and a uniform error envelope,
plus a health route. Resource routers (auth, dashboard, bills, ...) are
mounted in later checkpoints. The OpenAPI schema served at /openapi.json
is the single source of truth for the generated frontend types.
"""

import asyncio
import logging
import time
from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routers import analytics, auth, bills, dashboard, export, mcp_debug, meta, profile, status, users
from app.core.config import DEV_JWT_SECRET, settings, validate_required_env
from app.middleware.error_handler import register_error_handlers
from app.middleware.hardening import RateLimitMiddleware, SecurityHeadersMiddleware
from app.middleware.perf import PerfMiddleware
from app.middleware.request_id import RequestIDMiddleware
from app.services import (
    dashboard_service,
    discrepancy_service,
    mcp_client,
    recovery_service,
    savings_service,
    user_store,
)

logger = logging.getLogger("startup")

# --- Runtime readiness state (additive; drives /health/ready, changes nothing else) ---
_APP_START = time.monotonic()
_READY = {"schedulers_started": False}

# --- Fail-fast production guards (run at import, before serving a single request) ---
if settings.is_production and settings.jwt_secret == DEV_JWT_SECRET:
    raise RuntimeError(
        "Refusing to start in production with the dev JWT secret. "
        "Set JWT_SECRET to a freshly generated value."
    )
if settings.is_production and settings.enable_mcp_debug:
    raise RuntimeError("ENABLE_MCP_DEBUG must be false in production (it is an MCP tool-call proxy).")
# Consolidated required-env validation (production only). Lists ALL missing values
# at once with a clear message. (REDIS_URL is intentionally not required — no Redis.)
_missing_env = validate_required_env()
if _missing_env:
    raise RuntimeError(
        "Missing/invalid required environment for production:\n  - " + "\n  - ".join(_missing_env)
    )

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    # No interactive docs / OpenAPI in production (they publish the internal API surface).
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/openapi.json",
)


@app.on_event("startup")
def _startup() -> None:
    # Create tables (idempotent) and seed the first admin from env if empty.
    user_store.init_db_and_seed()
    logger.info("Startup complete (env=%s, mcp_debug=%s).", settings.environment, settings.enable_mcp_debug)


@app.on_event("startup")
async def _start_background_jobs() -> None:
    # Keep the slow enumerations OFF the request path: schedulers recompute them on
    # a fixed cadence and the endpoints always serve the warm result.
    #   • dashboard       (~6s fan-out) — every 5 min
    #   • savings         (~1.4 min)    — every 30 min
    #   • claimable-rate  (~260s) — every 30 min
    #   • dispute-lines   (enumeration per window+min_diff) — every 30 min
    #   • trend-recovery  (~27s)  — every 10 min
    dashboard_service.start_dashboard_scheduler()
    savings_service.start_savings_scheduler()
    discrepancy_service.start_claimable_scheduler()
    discrepancy_service.start_lines_scheduler()
    recovery_service.start_recovery_scheduler()
    _READY["schedulers_started"] = True
    logger.info(
        "startup: 5 background schedulers started (dashboard/savings/claimable/dispute-lines/recovery); "
        "mcp_configured=%s.",
        bool(settings.mcp_connect_url),
    )

    # Best-effort MCP connectivity check — non-blocking (own task) and non-fatal, so a
    # cold/unreachable MCP logs a clear reason without delaying or crashing startup.
    async def _probe_mcp() -> None:
        if not settings.mcp_connect_url:
            logger.warning("startup: MCP not configured (MCP_URL/MCP_TOKEN blank) — endpoints will serve 'unavailable'.")
            return
        try:
            info = await mcp_client.connection_info()
            logger.info("startup: MCP reachable (transport=%s).", info.get("transport"))
        except Exception as exc:  # noqa: BLE001 — diagnostic only
            logger.warning("startup: MCP connectivity check FAILED (non-fatal): %r", exc)

    asyncio.create_task(_probe_mcp())

# --- Middleware (add_middleware is LIFO: last-added is outermost) ---
# PerfMiddleware added last → outermost, so it times the full request and installs
# the per-request MCP stats contextvar before any downstream handler runs.
app.add_middleware(RequestIDMiddleware)
app.add_middleware(PerfMiddleware)
# Security hardening (added before CORS so CORS stays the OUTERMOST layer and still
# answers preflight). Pure ASGI → no effect on the MCP stats contextvar. Additive:
# headers + rate-gating only; response bodies/values are untouched.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # X-Request-ID always; the X-*perf headers are only ever present on the admin
    # Debug Panel's opt-in requests (PerfMiddleware sets them only when x-perf-debug
    # is sent), so exposing them changes nothing for normal page traffic.
    expose_headers=[
        "X-Request-ID",
        "X-MCP-Calls",
        "X-MCP-Real-Calls",
        "X-MCP-Cache-Hits",
        "X-MCP-Seconds",
        "X-Endpoint-Seconds",
    ],
)

register_error_handlers(app)


@app.get(f"{settings.api_prefix}/health", tags=["meta"])
def health() -> dict:
    """Liveness probe used by the frontend refresh button / dev smoke tests."""
    return {"status": "ok", "service": settings.app_name, "version": settings.version}


@app.get(f"{settings.api_prefix}/health/live", tags=["meta"])
def health_live() -> dict:
    """Liveness: the process is up and serving. Never touches MCP/DB — a fast probe
    for orchestrators (restart the pod only if this fails)."""
    return {"status": "alive", "uptime_seconds": round(time.monotonic() - _APP_START, 1)}


@app.get(f"{settings.api_prefix}/health/ready", tags=["meta"])
def health_ready(response: Response) -> dict:
    """Readiness: safe to receive traffic. Ready once startup finished (schedulers
    launched) and the MCP is configured. Returns 503 until then so a load balancer
    holds traffic during boot. Does NOT call MCP (readiness stays fast and doesn't
    flap on a transient downstream blip — MCP outages degrade to 'unavailable', not
    a dead pod)."""
    mcp_configured = bool(settings.mcp_connect_url)
    ready = _READY["schedulers_started"] and mcp_configured
    if not ready:
        response.status_code = 503
    return {
        "status": "ready" if ready else "not_ready",
        "schedulers_started": _READY["schedulers_started"],
        "mcp_configured": mcp_configured,
        "uptime_seconds": round(time.monotonic() - _APP_START, 1),
    }


# --- Resource routers ---
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(dashboard.router, prefix=settings.api_prefix)
app.include_router(bills.router, prefix=settings.api_prefix)
app.include_router(analytics.router, prefix=settings.api_prefix)
app.include_router(export.router, prefix=settings.api_prefix)
app.include_router(profile.router, prefix=settings.api_prefix)
app.include_router(users.router, prefix=settings.api_prefix)
# Read-only source-provenance metadata (drives the Live/Sample badges).
app.include_router(meta.router, prefix=settings.api_prefix)
# MCP status view (live-vs-mock snapshot across every dashboard endpoint).
app.include_router(status.router, prefix=settings.api_prefix)
# MCP inspection endpoints (tool-call proxy + schema dump) — mounted ONLY when
# ENABLE_MCP_DEBUG=true so they never ship to production.
if settings.enable_mcp_debug:
    app.include_router(mcp_debug.router, prefix=settings.api_prefix)


# --- Static frontend (single-container deploy) ---------------------------------
# Serve the built Vite bundle from FastAPI when it exists (production image). API
# routes are registered above, so only non-/api paths fall through to here. SPA
# fallback: unknown paths return index.html so client-side routing works.
_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "static"
if (_FRONTEND_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=_FRONTEND_DIR / "assets"), name="assets")

    @app.get("/", include_in_schema=False)
    def _index() -> FileResponse:
        return FileResponse(_FRONTEND_DIR / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    def _spa_fallback(full_path: str):
        # Unknown API paths must 404 as API, not silently return the SPA shell.
        if full_path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (_FRONTEND_DIR / full_path).resolve()
        if candidate.is_file() and _FRONTEND_DIR.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(_FRONTEND_DIR / "index.html")
