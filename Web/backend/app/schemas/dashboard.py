"""Dashboard API contract — KPI tiles, courier billing, distribution, state cost."""

from typing import Literal

from pydantic import BaseModel

KpiFormat = Literal["currency", "number", "percent"]
DeltaTone = Literal["positive", "negative", "neutral"]


class Kpi(BaseModel):
    key: str
    label: str
    value: float
    format: KpiFormat
    # Signed % change vs the previous equal-length window (arrow direction).
    delta: float
    # Whether that change is good/bad BY MEANING (cost↑=negative, orders↑=positive) —
    # the UI colors by this, not by the sign.
    delta_tone: DeltaTone
    # False when no previous-window value was available → the UI shows no delta.
    has_delta: bool = False
    # Optional context line (e.g. the SLA breakdown). Additive.
    subtitle: str | None = None
    # True when the selected window returned no data (e.g. an empty "Today") → the UI
    # renders "N/A" instead of a misleading ₹0/0. Never fabricated.
    unavailable: bool = False


class DistributionSlice(BaseModel):
    name: str
    value: int


class StateCostRow(BaseModel):
    state: str
    total_cost: float


class DashboardResponse(BaseModel):
    kpis: list[Kpi]
    distribution: list[DistributionSlice]
    state_cost: list[StateCostRow]
    source: Literal["live", "mock", "unavailable"] = "mock"
    date_field: str = "order_date"


class CourierBillingRow(BaseModel):
    """Per-courier FORWARD cost broken into real rate_summary components
    (fuel/other are always 0 → omitted). base_freight/gst/cod_charges are SAMPLED
    (sample-scale ₹). rto_actual is the REAL population RTO cost from
    shipping_cost_summary — kept separate (rate_summary.rto is a quoted rate
    carried on ~99% of orders, not actual returns), rendered in its own chart."""

    courier: str
    base_freight: float
    gst: float
    cod_charges: float
    total: float  # forward sample total = base_freight + gst + cod_charges
    rto_actual: float  # real RTO cost (population), not sampled — its own chart


class CourierBillingResponse(BaseModel):
    rows: list[CourierBillingRow]
    sample_size: int  # orders with a rate_summary.forward block
    total_matched: int
    is_full: bool = False  # True → sampled the whole population ("all N")
    source: Literal["live", "mock", "unavailable"] = "mock"
    date_field: str = "order_date"


class RateDiffKpi(BaseModel):
    """Isolated 'Rate Diff to Investigate' KPI (weight_reconciliation is slow, so
    it is fetched separately from the main dashboard)."""

    kpi: Kpi
    source: Literal["live", "mock", "unavailable"] = "mock"
    date_field: str = "reconciliation_at"
