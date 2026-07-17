"""FastAPI application entrypoint.

Checkpoint 1: boots with CORS, request-id, and a uniform error envelope,
plus a health route. Resource routers (auth, dashboard, bills, ...) are
mounted in later checkpoints. The OpenAPI schema served at /openapi.json
is the single source of truth for the generated frontend types.
"""

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routers import analytics, auth, bills, dashboard, export, mcp_debug, meta, profile, status, users
from app.core.config import DEV_JWT_SECRET, settings
from app.middleware.error_handler import register_error_handlers
from app.middleware.request_id import RequestIDMiddleware
from app.services import user_store

logger = logging.getLogger("startup")

# --- Fail-fast production guards (run at import, before serving a single request) ---
if settings.is_production and settings.jwt_secret == DEV_JWT_SECRET:
    raise RuntimeError(
        "Refusing to start in production with the dev JWT secret. "
        "Set JWT_SECRET to a freshly generated value."
    )
if settings.is_production and settings.enable_mcp_debug:
    raise RuntimeError("ENABLE_MCP_DEBUG must be false in production (it is an MCP tool-call proxy).")

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

# --- Middleware (order matters: request-id outermost so it wraps everything) ---
app.add_middleware(RequestIDMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

register_error_handlers(app)


@app.get(f"{settings.api_prefix}/health", tags=["meta"])
def health() -> dict:
    """Liveness probe used by the frontend refresh button / dev smoke tests."""
    return {"status": "ok", "service": settings.app_name, "version": settings.version}


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
