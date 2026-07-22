"""COD reconciliation API contract.

Reshaped in Phase 2: the Ship MCP exposes COD *value* per courier
(order_analytics) and *global* remittance (cod_remittance_summary) — but NOT
per-courier remitted/pending/TDS. So the detail table is Courier · Orders · COD
Value, and the per-courier chart is "COD value by courier". Fictional
remitted/pending/TDS columns were removed rather than faked.
"""

from typing import Literal

from pydantic import BaseModel

from app.schemas.dashboard import Kpi


class CodCourier(BaseModel):
    """Per-courier COD value (order_analytics group_by=courier)."""

    courier: str
    orders: int
    cod_value: float


class CodWeekly(BaseModel):
    """One weekly window. Both are GLOBAL (no per-courier split exists)."""

    week: str
    collected: float  # COD value booked in the window (order_analytics.cod_value)
    remitted: float  # COD remitted in the window (cod_remittance_summary.remitted)


class CodResponse(BaseModel):
    kpis: list[Kpi]
    reconciliation: list[CodCourier]
    weekly: list[CodWeekly]
    # --- Additive provenance meta (drives the Live/Sample badge; flips to
    # "mock" whenever the live fetch fails or the MCP token is blank). ---
    source: Literal["live", "mock", "unavailable"] = "mock"
    date_field: str = "order_date"


class CodPendingCourier(BaseModel):
    """Per-courier COD aging (cod_remittance_aging group_by=courier), joined with
    order_analytics for the COD amount."""

    courier: str
    cod_shipments: int  # cod_remittance_aging.records
    cod_amount: float | None = None  # order_analytics.cod_value (None → "N/A")
    remitted: float  # cod_remittance_aging.remitted
    pending: float  # cod_remittance_aging.outstanding
    status: str  # Pending | Settled | Overdue | Mismatched (derived)


class CodPendingResponse(BaseModel):
    rows: list[CodPendingCourier] = []
    source: Literal["live", "mock", "unavailable"] = "mock"
    date_field: str = "order_date"


# --- COD Intelligence (additive; the existing CodResponse is untouched) --------
class CodPaymentSplit(BaseModel):
    """COD vs Prepaid order/value split (order_analytics group_by=payment_type)."""

    payment_type: str  # "COD" | "Prepaid"
    orders: int
    order_value: float


class CodUnavailableMetric(BaseModel):
    """An intelligence metric that CANNOT be derived from the MCP, with the exact
    missing capability. Surfaced verbatim so the UI can show 'Not available from
    MCP' honestly instead of fabricating a value."""

    metric: str
    reason: str


class CodPaymentEconomics(BaseModel):
    """Per-payment-type unit economics. Cost fields are the shipping_cost_summary
    (group_by=payment_type) live values; avg_order_value is order_analytics
    order_value / orders for the SAME payment type (never blended)."""

    payment_type: str  # "COD" | "Prepaid"
    orders: int
    avg_order_value: float  # order_analytics: order_value / orders
    avg_shipping_cost: float  # shipping_cost_summary.avg_cost
    fwd_cost: float  # shipping_cost_summary.fwd_cost
    rto_cost: float  # shipping_cost_summary.rto_cost
    total_cost: float  # shipping_cost_summary.total_cost


class CodDimensionRow(BaseModel):
    """One warehouse/seller row (order_analytics group_by=warehouse|seller). COD
    intensity = the row's own cod_value / order_value (single row, single tool)."""

    group: str
    orders: int
    order_value: float
    cod_value: float
    cod_intensity_pct: float  # cod_value / order_value * 100


class CodIntelligenceResponse(BaseModel):
    """Additive COD-intelligence layer. All KPIs are live MCP fields or ratios of
    live fields from a SINGLE tool (never cross-tool, never fabricated)."""

    kpis: list[Kpi] = []
    payment_split: list[CodPaymentSplit] = []
    unit_economics: list[CodPaymentEconomics] = []
    warehouse_cod: list[CodDimensionRow] = []
    seller_cod: list[CodDimensionRow] = []
    unavailable: list[CodUnavailableMetric] = []
    source: Literal["live", "mock", "unavailable"] = "mock"
    date_field: str = "order_date"
