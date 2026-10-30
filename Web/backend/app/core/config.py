"""Application settings, loaded from environment / .env via pydantic-settings.

This is the single place the backend reads configuration. Services and
middleware import `settings` from here — never os.environ directly.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.log_redaction import install_secret_redaction

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

    # --- DeoDap Central single sign-on (optional; see app/auth/central_sso.py) ---
    # PUBLIC key (Ed25519, PEM) of DeoDap Central. Empty = SSO off and the app behaves exactly as
    # before (its own login only). Relative paths are resolved against the backend folder. Only a
    # public key is configured here: no Central secret is ever needed by this app.
    central_sso_public_key_file: str = ""
    central_sso_issuer: str = "deodap-central"
    central_sso_audience: str = "mcp-dashboard"
    # Upper bound on an assertion's lifetime (exp - iat); Central issues 60-second assertions.
    central_sso_max_lifetime_seconds: int = 120

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

    # --- Public URL sub-paths ---
    # Sub-paths the app may be served under behind the reverse proxy, which sends the one in
    # use as `X-Forwarded-Prefix` (e.g. https://care.deodap.info/courier-billing/). Only these
    # exact values are honoured: the prefix is written into the served page, so it is never
    # taken from an arbitrary header value. Requests without the header are served at "/".
    public_base_paths: str = "/courier-billing"

    # --- Session cookie (standalone login) ---
    # The login token lives in an httpOnly cookie scoped to the API path ("<prefix>/api"), so
    # page scripts — including other apps sharing the domain — can't read it, and requests to
    # other paths of the domain never carry it.
    auth_cookie_name: str = "mcp_session"

    # --- MCP (Phase 2 live integration) ---
    # The Ship MCP server authenticates via a URL query param (?mcp_token=...),
    # NOT a Bearer header. Blank token => services fall back to mock data.
    mcp_url: str = ""
    mcp_token: str = ""
    # Per-MCP-call timeout. The two heaviest Ship tools (weight_reconciliation_summary,
    # cod_remittance_summary) have real latency at/above 12s, so a 12s cap timed them
    # out and made /api/cod, /api/weight and /api/discrepancies report "unavailable".
    # 30s clears their latency with headroom while still failing well before a page
    # would truly hang. Override via MCP_TIMEOUT_SECONDS in the env.
    mcp_timeout_seconds: float = 30.0
    # Per-call timeout for BACKGROUND work that no user request is waiting on — the
    # full refresh and the warm-cache rebuilds (dashboard / claimable / savings /
    # dispute lines / recovery). weight_reconciliation_summary and
    # reconciliation_disputes measured 47–72s per call (Oct 2026), so the 30s request
    # timeout above made those jobs fail every time. Page requests keep the 30s cap.
    background_mcp_timeout_seconds: float = 180.0
    # Global cap on SIMULTANEOUS real MCP round-trips (single-flight/cache hits do
    # NOT take a slot). The Ship MCP contends badly under load — a ~5s tool balloons
    # to ~18s when ~19 calls fire at once (which a Retry storm does). Bounding total
    # concurrency to a conservative default keeps each round-trip fast. Tune via
    # MCP_MAX_CONCURRENCY; it never reduces, skips, or samples data — only paces calls.
    mcp_max_concurrency: int = 6
    # Of those slots, at most this many may be used by BACKGROUND work (the 30-minute
    # full refresh, warm-cache rebuilds, KPI sparklines). The rest stay free for the
    # page a user just opened, so a running refresh never queues a page load behind
    # ~100 background calls. Background work still completes, just at this pace.
    mcp_background_max_concurrency: int = 3
    # When the live MCP call fails we serve an honest "unavailable" state (empty
    # data, source="unavailable") — NEVER fixture numbers. This flag lets local dev
    # opt back into the mock fixtures; it must stay false in production.
    use_mock_fallback: bool = False
    # Expose the /_mcp/tools and /_mcp/probe inspection endpoints (an MCP tool-call
    # proxy — never ship to production). Off by default; set ENABLE_MCP_DEBUG=true
    # only for local dev.
    enable_mcp_debug: bool = False

    # --- Full live-data refresh ("Fetch Data Now" + automatic refresh) ---
    # A background job re-fetches every dashboard dataset from the Ship MCP for one
    # date window (see services/refresh_service.py). The automatic run refreshes the
    # frontend's DEFAULT window (Last 30 Days) every AUTO_REFRESH_INTERVAL_HOURS; the
    # manual button refreshes whatever window the user has selected. Only one full
    # refresh runs at a time (manual and scheduled share the same job slot).
    auto_refresh_enabled: bool = True
    auto_refresh_interval_hours: float = 0.5  # every 30 minutes
    # A SCHEDULED run reuses a slow warm-cache dataset (dashboard / claimable / savings /
    # dispute lines / recovery) that its own scheduler rebuilt within this many
    # seconds, instead of rebuilding it again, and is skipped entirely if a refresh of
    # the same window succeeded this recently. The manual button never reuses.
    auto_refresh_reuse_seconds: float = 900.0
    # First automatic run after startup — delayed so the existing warm-cache
    # schedulers finish their startup fan-out before a full refresh adds load.
    auto_refresh_initial_delay_seconds: float = 300.0
    # The frontend computes "Last 30 Days" in the user's LOCAL date (IST); the
    # scheduled refresh uses the same calendar day so it warms the exact window the
    # default dashboard requests. IST has no DST, so a fixed offset is exact.
    auto_refresh_utc_offset_minutes: int = 330
    # Upper bound for ONE dataset inside a refresh (the slowest, claimable-rate, is
    # ~260s and may queue behind other heavy enumerations on the shared job lock).
    refresh_dataset_timeout_seconds: float = 1200.0

    # --- Security hardening (Phase 5, additive) ---
    # Response security headers. Enabled by default; CSP is tuned for a Vite React
    # SPA (external bundle 'self'; inline styles allowed — recharts + style attrs).
    # Override CONTENT_SECURITY_POLICY in the env if the deployment needs a different
    # policy. HSTS is meaningful once TLS terminates at the proxy in front of the app.
    security_headers_enabled: bool = True
    content_security_policy: str = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; "
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
    def public_base_paths_list(self) -> list[str]:
        return [p.strip().rstrip("/") for p in self.public_base_paths.split(",") if p.strip().rstrip("/")]

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

# Keep the MCP token out of every log line from here on (it travels in the connect URL).
install_secret_redaction(lambda: [settings.mcp_token])


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
