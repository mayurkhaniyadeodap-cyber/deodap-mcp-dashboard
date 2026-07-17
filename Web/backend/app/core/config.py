"""Application settings, loaded from environment / .env via pydantic-settings.

This is the single place the backend reads configuration. Services and
middleware import `settings` from here — never os.environ directly.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# The insecure dev fallback secret. Production must override JWT_SECRET; the app
# refuses to boot in production while jwt_secret still equals this (see main.py).
DEV_JWT_SECRET = "dev-secret-change-me-please-32chars-min"


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
    # Users are stored here (SQLAlchemy User model). SQLite file by default; point
    # DATABASE_URL at Postgres/etc. in production if desired.
    database_url: str = "sqlite:///./deodap.db"

    # --- CORS ---
    # Comma-separated in the env; parsed into a list below.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- MCP (Phase 2 live integration) ---
    # The Ship MCP server authenticates via a URL query param (?mcp_token=...),
    # NOT a Bearer header. Blank token => services fall back to mock data.
    mcp_url: str = ""
    mcp_token: str = ""
    mcp_timeout_seconds: float = 30.0
    # Expose the /_mcp/tools and /_mcp/probe inspection endpoints (an MCP tool-call
    # proxy — never ship to production). Off by default; set ENABLE_MCP_DEBUG=true
    # only for local dev.
    enable_mcp_debug: bool = False

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
