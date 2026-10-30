"""Full live-data refresh routes — the "Fetch Data Now" button + its status.

Starting a refresh is role-gated like exports (admin / employee): it fans out to
every Ship MCP tool. Everyone signed in can read the status (progress, last
attempt, last success), which the navbar polls.
"""

from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException

from app.api.deps import get_current_user, require_role
from app.auth.roles import Role
from app.core.config import settings
from app.schemas.auth import UserPublic
from app.schemas.refresh import RefreshRequest, RefreshStartResponse, RefreshStatus
from app.services import refresh_service

router = APIRouter(tags=["refresh"])


def _valid_window(req: RefreshRequest) -> tuple[str | None, str | None]:
    """Both dates or neither (→ the default Last 30 Days); ISO YYYY-MM-DD; from ≤ to."""
    if req.date_from is None and req.date_to is None:
        return refresh_service.default_window()
    if req.date_from is None or req.date_to is None:
        raise HTTPException(422, "Provide both 'from' and 'to', or neither.")
    try:
        frm, to = date.fromisoformat(req.date_from), date.fromisoformat(req.date_to)
    except ValueError as exc:
        raise HTTPException(422, "Dates must be YYYY-MM-DD.") from exc
    if frm > to:
        raise HTTPException(422, "'from' must be on or before 'to'.")
    return frm.isoformat(), to.isoformat()


@router.get("/refresh/status", response_model=RefreshStatus, dependencies=[Depends(get_current_user)])
def refresh_status() -> RefreshStatus:
    return refresh_service.get_status()


@router.post("/refresh", response_model=RefreshStartResponse)
async def start_refresh(
    req: RefreshRequest = Body(default_factory=RefreshRequest),
    user: UserPublic = Depends(require_role(Role.admin, Role.employee)),
) -> RefreshStartResponse:
    date_from, date_to = _valid_window(req)
    if not settings.mcp_connect_url:
        return RefreshStartResponse(
            accepted=False, message="Ship MCP is not configured (MCP_URL / MCP_TOKEN).",
            status=refresh_service.get_status(),
        )
    accepted, current = refresh_service.start_refresh(
        trigger="manual", date_from=date_from, date_to=date_to, triggered_by=user.name,
    )
    if accepted:
        message = f"Fetching live data for {date_from} to {date_to}."
    else:
        message = (
            f"A {current.trigger or ''} refresh is already running "
            f"({current.completed}/{current.total} done); no duplicate was started."
        )
    return RefreshStartResponse(accepted=accepted, message=message, status=current)
