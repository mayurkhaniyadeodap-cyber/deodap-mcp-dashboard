"""MCP status view contract (GET /api/_status).

A single diagnostic snapshot of the live-vs-mock state of every dashboard
endpoint, reusing each endpoint's own per-response `source` field (no new data
sources). Additive/read-only — it does not touch any existing response model.
"""

from typing import Literal

from pydantic import BaseModel


class EndpointStatus(BaseModel):
    endpoint: str
    source: Literal["live", "mock"]
    mcp_tools: list[str]  # the MCP tools this endpoint ACTUALLY calls
    load_ms: int  # wall-clock for this probe (its own + shared caches apply)
    notes: str


class StatusResponse(BaseModel):
    mcp_connected: bool
    mcp_url: str  # token masked
    tool_count: int  # from list_tools()
    token_present: bool
    endpoints: list[EndpointStatus]
