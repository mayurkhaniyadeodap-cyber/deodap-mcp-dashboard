"""Application settings, loaded from environment / .env via pydantic-settings.

This is the single place the backend reads configuration. Services and
middleware import `settings` from here — never os.environ directly.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# The insecure dev fallback secret. Production must override JWT_SECRET; the app
# refuses to boot in production while jwt_secret still equals this (see main.py).
DEV_JWT_SECRET = "dev-secret-change-me-please-32chars-min"


def _default_database_url() -> str:
    """A STABLE, absolute SQLite path — never relative to the process CWD, so the
    SAME database is used no matter where the backend is launched from (the old
    `sqlite:///./deodap.db` opened a different, empty file per working directory,
    which is why added employees vanished after a restart).

    - Production container: the persistent volume is mounted at `/data`
      (docker-compose `dashboard-data:/data`), so the DB lives there and survives
      restarts/redeploys.
    - Otherwise (local dev): anchor the file to the backend package root.
    DATABASE_URL in the env always overrides this.
    """
    data_dir = Path("/data")
    if data_dir.is_dir():
        return f"sqlite:///{(data_dir / 'deodap.db').as_posix()}"
    backend_root = Path(__file__).resolve().parents[2]  # …/app/core/config.py → backend/
    return f"sqlite:///{(backend_root / 'deodap.db').as_posix()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- App ---
    app_name: str = "DeoDap MCP Dashboard API"
    api_prefix: str = "/api"
    version: str = "0.1.0"
    # "development" | "production". In production the app refuses to boot with the
    # dev JWT secret (see main.py startup guard).
    environment: str = "development"

    # --- Auth / JWT ---
    # Dev-only fallback. Production MUST set JWT_SECRET from the env to a freshly
    # generated value (e.g. `python -c "import secrets; print(secrets.token_urlsafe(48))"`).
    jwt_secret: str = DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480  # 8h (Phase 1 spec)

    # First-admin seed (only used when the users table is empty). No password is
    # baked in — set ADMIN_PASSWORD, or a random one is generated and logged once.
    admin_email: str = "admin@deodap.in"
    admin_password: str = ""

    # --- Database ---
    # Users are stored here (SQLAlchemy User model). Absolute, CWD-independent
    # SQLite path by default (see _default_database_url); point DATABASE_URL at the
    # persistent volume (sqlite:////data/deodap.db) or Postgres/etc. in production.
    database_url: str = _default_database_url()

    # --- CORS ---
    # Comma-separated in the env; parsed into a list below.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- MCP (Phase 2 live integration) ---
    # The Ship MCP server authenticates via a URL query param (?mcp_token=...),
    # NOT a Bearer header. Blank token => services fall back to mock data.
    mcp_url: str = ""
    mcp_token: str = ""
    # Fail FAST into the "data unavailable" state instead of hanging a page for a
    # minute when the MCP is unreachable (was 30s → ~60s across retried transports).
    mcp_timeout_seconds: float = 12.0
    # When the live MCP call fails we serve an honest "unavailable" state (empty
    # data, source="unavailable") — NEVER fixture numbers. This flag lets local dev
    # opt back into the mock fixtures; it must stay false in production.
    use_mock_fallback: bool = False
    # Expose the /_mcp/tools and /_mcp/probe inspection endpoints (an MCP tool-call
    # proxy — never ship to production). Off by default; set ENABLE_MCP_DEBUG=true
    # only for local dev.
    enable_mcp_debug: bool = False

    # --- Security hardening (Phase 5, additive) ---
    # Response security headers. Enabled by default; CSP is tuned for a Vite React
    # SPA (external bundle 'self'; inline styles allowed — recharts + style attrs).
    # Override CONTENT_SECURITY_POLICY in the env if the deployment needs a different
    # policy. HSTS is meaningful once TLS terminates at the proxy in front of the app.
    security_headers_enabled: bool = True
    content_security_policy: str = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; "
        "base-uri 'self'; form-action 'self'"
    )
    hsts_max_age_seconds: int = 31536000  # 1 year
    # In-memory sliding-window rate limiting (single-worker deploy). Off → no limiting.
    rate_limit_enabled: bool = True

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def mcp_connect_url(self) -> str:
        """Full MCP connect URL: {MCP_URL}?mcp_token={MCP_TOKEN}. Empty if unset."""
        if not self.mcp_url or not self.mcp_token:
            return ""
        sep = "&" if "?" in self.mcp_url else "?"
        return f"{self.mcp_url}{sep}mcp_token={self.mcp_token}"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def validate_required_env() -> list[str]:
    """Return a list of missing/invalid REQUIRED env values (empty = all good).

    Enforced only in PRODUCTION (dev keeps working with defaults / a blank MCP).
    NOTE: REDIS_URL is intentionally NOT checked — this project uses in-process
    caching and has no Redis dependency; requiring it would break a working deploy.
    """
    if not settings.is_production:
        return []
    missing: list[str] = []
    if settings.jwt_secret == DEV_JWT_SECRET or len(settings.jwt_secret) < 32:
        missing.append("JWT_SECRET (must be a strong, non-default value ≥32 chars)")
    if not settings.database_url:
        missing.append("DATABASE_URL")
    if not settings.mcp_url:
        missing.append("MCP_URL")
    if not settings.mcp_token:
        missing.append("MCP_TOKEN")
    return missing
