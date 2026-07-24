"""MCP status view (GET /api/_status).

A single diagnostic snapshot of live-vs-mock state across every dashboard
endpoint. Own endpoint + service; does not touch any existing route or service.
"""

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user, require_role
from app.auth.roles import Role
from app.schemas.status import SchedulersResponse, StatusResponse
from app.services import status_service

router = APIRouter(tags=["_status"], dependencies=[Depends(get_current_user)])


@router.get("/_status", response_model=StatusResponse)
async def mcp_status(
    include_slow: bool = Query(default=False, description="Also probe the slow endpoints (savings-opportunity, trend-recovery)."),
) -> StatusResponse:
    return await status_service.get_status(include_slow=include_slow)


@router.get(
    "/_status/schedulers",
    response_model=SchedulersResponse,
    dependencies=[Depends(require_role(Role.admin))],
)
def scheduler_status() -> SchedulersResponse:
    """ADMIN-ONLY, additive, read-only. Background warm-cache scheduler telemetry
    (cache age / next refresh) from the EXISTING warm timestamps — changes no
    scheduler behavior and touches no existing response."""
    return status_service.get_scheduler_status()
