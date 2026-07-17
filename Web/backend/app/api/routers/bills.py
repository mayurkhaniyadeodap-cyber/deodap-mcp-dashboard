"""Bills route — server-side search, status filter, sort, and pagination."""

from fastapi import APIRouter, Depends, Query

from app.api.deps import DateRange, date_range_params, get_current_user
from app.schemas.bills import Bill, BillStatus
from app.schemas.common import Page
from app.services import bills_service

router = APIRouter(tags=["bills"], dependencies=[Depends(get_current_user)])


@router.get("/bills", response_model=Page[Bill])
async def list_bills(
    search: str | None = Query(default=None, description="Match AWB, courier, or zone"),
    status: BillStatus | None = Query(default=None),
    sort: str | None = Query(default=None, description="field:dir e.g. amount:desc"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    dates: DateRange = Depends(date_range_params),
) -> Page[Bill]:
    return await bills_service.list_bills(
        search=search, status=status, sort=sort, page=page, page_size=page_size,
        date_from=dates.date_from, date_to=dates.date_to,
    )
