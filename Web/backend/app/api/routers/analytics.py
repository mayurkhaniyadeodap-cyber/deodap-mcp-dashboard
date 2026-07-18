"""Read-only analytics routes: couriers, discrepancies, cod, zones, weight,
trend, settings. Grouped here because they share the same shape (auth-protected
GET with no query params). Each delegates to its service (the only data source).
"""

from fastapi import APIRouter, Depends, Query

from app.api.deps import DateRange, date_range_params, get_current_user
from app.schemas.cod import CodPendingResponse, CodResponse
from app.schemas.couriers import Courier
from app.schemas.discrepancies import DiscrepancyResponse
from app.schemas.dispute_lines import DisputeInvoicesResponse, DisputeLinesResponse
from app.schemas.reconciliation import ClaimableRateResponse, ReconciliationResponse
from app.schemas.recovery import RecoveryResponse
from app.schemas.savings import SavingsResponse
from app.schemas.settings import SettingsResponse
from app.schemas.trend import TrendResponse
from app.schemas.weight import WeightResponse
from app.schemas.zones import ZonesResponse
from app.services import (
    cod_service,
    courier_service,
    discrepancy_service,
    recovery_service,
    savings_service,
    settings_service,
    trend_service,
    weight_service,
    zone_service,
)

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/couriers", response_model=list[Courier], tags=["couriers"])
async def list_couriers(dates: DateRange = Depends(date_range_params)) -> list[Courier]:
    return await courier_service.list_couriers(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/discrepancies", response_model=DiscrepancyResponse, tags=["discrepancies"])
async def get_discrepancies(dates: DateRange = Depends(date_range_params)) -> DiscrepancyResponse:
    return await discrepancy_service.get_discrepancies(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/discrepancies/reconciliation", response_model=ReconciliationResponse, tags=["discrepancies"])
async def get_reconciliation(dates: DateRange = Depends(date_range_params)) -> ReconciliationResponse:
    # SLOW (reconciliation_disputes ×2 + reconciliation_summary); own 60s cache,
    # separate endpoint so it never blocks the fast /discrepancies panels.
    return await discrepancy_service.get_reconciliation(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/disputes/claimable-rate", response_model=ClaimableRateResponse, tags=["discrepancies"])
async def get_claimable_rate(dates: DateRange = Depends(date_range_params)) -> ClaimableRateResponse:
    # SLOW on cold cache (paginates the whole ≥₹50 dispute population from
    # reconciliation_disputes, ~28 pages @ 500, concurrency 4); 30-min cache.
    return await discrepancy_service.get_claimable_rate(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/disputes/lines", response_model=DisputeLinesResponse, tags=["discrepancies"])
async def get_dispute_lines(
    dates: DateRange = Depends(date_range_params),
    min_diff: float = Query(default=50, ge=0),
    sort_by: str = Query(default="rate_diff", pattern="^(rate_diff|weight_diff)$"),
    courier_slug: str | None = Query(default=None),
    invoice_no: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> DisputeLinesResponse:
    # Per-AWB dispute list. Enumeration (per window+min_diff) is served warm — the
    # filter/sort/page below are in-memory. Priced (applied_rate>0), ≥min_diff,
    # reconciliation_at basis (same honesty rules as the claimable KPI).
    return await discrepancy_service.get_dispute_lines(
        date_from=dates.date_from, date_to=dates.date_to, min_diff=min_diff,
        sort_by=sort_by, courier_slug=courier_slug, invoice_no=invoice_no,
        page=page, page_size=page_size,
    )


@router.get("/disputes/invoices", response_model=DisputeInvoicesResponse, tags=["discrepancies"])
async def get_dispute_invoices(
    dates: DateRange = Depends(date_range_params),
    min_diff: float = Query(default=50, ge=0),
    courier_slug: str | None = Query(default=None),
    invoice_no: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
) -> DisputeInvoicesResponse:
    # Invoice-grouped view — dispute lines bundled by carrier invoice. Totals are
    # summed from the SAME priced lines as /disputes/lines, so they reconcile.
    return await discrepancy_service.get_dispute_invoices(
        date_from=dates.date_from, date_to=dates.date_to, min_diff=min_diff,
        courier_slug=courier_slug, invoice_no=invoice_no, page=page, page_size=page_size,
    )


@router.get("/savings-opportunity", response_model=SavingsResponse, tags=["savings"])
async def get_savings_opportunity(dates: DateRange = Depends(date_range_params)) -> SavingsResponse:
    # SLOW (pincode_serviceability ~9s p95); own 30-min cache. Separate endpoint so
    # it never blocks the Discrepancies page's fast panels.
    return await savings_service.get_savings_opportunity(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/cod", response_model=CodResponse, tags=["cod"])
async def get_cod(dates: DateRange = Depends(date_range_params)) -> CodResponse:
    return await cod_service.get_cod(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/cod/pending", response_model=CodPendingResponse, tags=["cod"])
async def get_cod_pending(dates: DateRange = Depends(date_range_params)) -> CodPendingResponse:
    # Per-courier COD aging (cod_remittance_aging + order_analytics). Own 60s cache.
    return await cod_service.get_cod_pending(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/zones", response_model=ZonesResponse, tags=["zones"])
async def get_zones(dates: DateRange = Depends(date_range_params)) -> ZonesResponse:
    return await zone_service.get_zones(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/weight", response_model=WeightResponse, tags=["weight"])
async def get_weight(dates: DateRange = Depends(date_range_params)) -> WeightResponse:
    return await weight_service.get_weight(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/trend", response_model=TrendResponse, tags=["trend"])
async def get_trend(dates: DateRange = Depends(date_range_params)) -> TrendResponse:
    return await trend_service.get_trend(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/trend-recovery", response_model=RecoveryResponse, tags=["trend"])
async def get_trend_recovery(dates: DateRange = Depends(date_range_params)) -> RecoveryResponse:
    # SLOW (7× weight_reconciliation_summary ≈ 27s); own 10-min cache, separate
    # endpoint so the fast Trend charts render immediately.
    return await recovery_service.get_recovery(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/settings", response_model=SettingsResponse, tags=["settings"])
def get_settings() -> SettingsResponse:
    return settings_service.get_settings()
