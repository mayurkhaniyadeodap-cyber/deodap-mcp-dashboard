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
    source: Literal["live", "mock"] = "mock"
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
    source: Literal["live", "mock"] = "mock"
    date_field: str = "order_date"
