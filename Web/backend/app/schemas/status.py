"""MCP status view contract (GET /api/_status).

A single diagnostic snapshot of the live-vs-mock state of every dashboard
endpoint, reusing each endpoint's own per-response `source` field (no new data
sources). Additive/read-only — it does not touch any existing response model.
"""

from typing import Literal

from pydantic import BaseModel


class EndpointStatus(BaseModel):
    endpoint: str
    source: Literal["live", "mock", "unavailable"]
    mcp_tools: list[str]  # the MCP tools this endpoint ACTUALLY calls
    load_ms: int  # wall-clock for this probe (its own + shared caches apply)
    notes: str


class Capability(BaseModel):
    """A dashboard capability whose feasibility is decided LIVE from the MCP tool
    schemas (not a hardcoded list). `available` flips as the server exposes new
    tools / params — e.g. courier-wise reconciliation unblocked when
    reconciliation_summary(group_by=courier) appeared."""

    domain: str
    capability: str  # what it would let us build
    needs: str  # the MCP enhancement it requires
    resolved_by: str | None = None  # the tool that satisfies it (when available)
    available: bool


class StatusResponse(BaseModel):
    mcp_connected: bool
    mcp_url: str  # token masked
    tool_count: int  # from list_tools()
    token_present: bool
    endpoints: list[EndpointStatus]
    capabilities: list[Capability] = []  # live-derived; blocked count = Σ(not available)


class SchedulerStatus(BaseModel):
    """Read-only telemetry for one background warm-cache scheduler (admin-only view).
    Timestamps are monotonic → age/next are relative seconds, not wall-clock."""

    name: str
    cadence_seconds: int  # how often the scheduler refreshes the primary window
    running: bool  # scheduler loop active (MCP configured)
    warm: bool  # the primary window currently has a cached result
    cache_age_seconds: float | None = None  # time since last refresh (None = never warmed)
    next_refresh_seconds: float | None = None  # cadence − age (None = never warmed)


class SchedulersResponse(BaseModel):
    schedulers: list[SchedulerStatus] = []
