"""MCP status view (GET /api/_status).

A single diagnostic snapshot of live-vs-mock state across every dashboard
endpoint. Own endpoint + service; does not touch any existing route or service.
"""

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user
from app.schemas.status import StatusResponse
from app.services import status_service

router = APIRouter(tags=["_status"], dependencies=[Depends(get_current_user)])


@router.get("/_status", response_model=StatusResponse)
async def mcp_status(
    include_slow: bool = Query(default=False, description="Also probe the slow endpoints (savings-opportunity, trend-recovery)."),
) -> StatusResponse:
    return await status_service.get_status(include_slow=include_slow)
