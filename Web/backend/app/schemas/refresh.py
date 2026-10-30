"""Full live-data refresh contract (GET /api/refresh/status, POST /api/refresh).

One background job re-fetches every dashboard dataset from the Ship MCP for one
date window — started by the "Fetch Data Now" button (manual) or the automatic
scheduler. Times are wall-clock UTC (timezone-aware) so the UI can show them.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RefreshState = Literal["idle", "running", "success", "partial", "failed"]
DatasetState = Literal["pending", "running", "success", "failed"]


class RefreshDatasetStatus(BaseModel):
    key: str  # stable id, e.g. "cod-pending"
    label: str  # human name shown in the progress list
    module: str  # dashboard module it belongs to (Dashboard, COD, ...)
    # TanStack Query key roots the frontend refetches once this dataset succeeded.
    query_keys: list[str] = []
    date_from: str | None = None  # the window this dataset was fetched for
    date_to: str | None = None
    status: DatasetState = "pending"
    error: str | None = None
    # Set when a scheduled run reused a recent result instead of fetching again.
    note: str | None = None
    duration_ms: int | None = None


class RefreshStatus(BaseModel):
    job_id: int = 0  # increments per job; 0 = no refresh has run since startup
    state: RefreshState = "idle"  # outcome of the current/last job
    running: bool = False
    trigger: Literal["manual", "scheduled"] | None = None
    triggered_by: str | None = None  # user name for a manual refresh
    date_from: str | None = None
    date_to: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    total: int = 0
    completed: int = 0  # finished datasets (success + failed)
    failed: int = 0
    datasets: list[RefreshDatasetStatus] = []
    last_attempt_at: datetime | None = None  # start of the most recent job
    last_success_at: datetime | None = None  # end of the most recent job with NO failures
    last_success_from: str | None = None
    last_success_to: str | None = None
    last_error: str | None = None  # summary of the most recent job's failures
    # MCP work done by the current/last job: tool calls requested, REAL round-trips to
    # the Ship MCP (fresh fetches), and calls deduplicated by cache / single-flight.
    mcp_requests: int = 0
    mcp_round_trips: int = 0
    mcp_deduplicated: int = 0
    auto_refresh_enabled: bool = False
    interval_hours: float = 0.0
    next_scheduled_at: datetime | None = None


class RefreshRequest(BaseModel):
    # The user's selected window (YYYY-MM-DD) — same `from`/`to` names as every GET.
    # Omitted → the default Last 30 Days.
    model_config = ConfigDict(populate_by_name=True)

    date_from: str | None = Field(default=None, alias="from")
    date_to: str | None = Field(default=None, alias="to")


class RefreshStartResponse(BaseModel):
    accepted: bool  # False → a refresh is already running (no duplicate started)
    message: str
    status: RefreshStatus
