"""Dashboard route."""

from fastapi import APIRouter, Depends

from app.api.deps import DateRange, date_range_params, get_current_user
from app.schemas.dashboard import CourierBillingResponse, DashboardResponse, RateDiffKpi
from app.services import dashboard_service

router = APIRouter(tags=["dashboard"], dependencies=[Depends(get_current_user)])


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(dates: DateRange = Depends(date_range_params)) -> DashboardResponse:
    return await dashboard_service.get_dashboard(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/dashboard/rate-diff", response_model=RateDiffKpi)
async def get_dashboard_rate_diff(dates: DateRange = Depends(date_range_params)) -> RateDiffKpi:
    # Slow (weight_reconciliation_summary); own 60s cache. Split out so the main
    # dashboard loads in ~3s and this KPI fetches with its own skeleton.
    return await dashboard_service.get_rate_diff(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/dashboard/courier-billing", response_model=CourierBillingResponse)
async def get_dashboard_courier_billing(dates: DateRange = Depends(date_range_params)) -> CourierBillingResponse:
    # Sampled component breakdown (needs a ~2,500-order stride sample of list_orders);
    # own cache + skeleton so the main dashboard stays fast.
    return await dashboard_service.get_courier_billing(date_from=dates.date_from, date_to=dates.date_to)
