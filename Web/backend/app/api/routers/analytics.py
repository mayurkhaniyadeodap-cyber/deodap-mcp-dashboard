"""Read-only analytics routes: couriers, discrepancies, cod, zones, weight,
trend, settings. Grouped here because they share the same shape (auth-protected
GET with no query params). Each delegates to its service (the only data source).
"""

from fastapi import APIRouter, Depends

from app.api.deps import DateRange, date_range_params, get_current_user
from app.schemas.cod import CodResponse
from app.schemas.couriers import Courier
from app.schemas.discrepancies import DiscrepancyResponse
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


@router.get("/savings-opportunity", response_model=SavingsResponse, tags=["savings"])
async def get_savings_opportunity(dates: DateRange = Depends(date_range_params)) -> SavingsResponse:
    # SLOW (pincode_serviceability ~9s p95); own 30-min cache. Separate endpoint so
    # it never blocks the Discrepancies page's fast panels.
    return await savings_service.get_savings_opportunity(date_from=dates.date_from, date_to=dates.date_to)


@router.get("/cod", response_model=CodResponse, tags=["cod"])
async def get_cod(dates: DateRange = Depends(date_range_params)) -> CodResponse:
    return await cod_service.get_cod(date_from=dates.date_from, date_to=dates.date_to)


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
