"""Dispute Lines contract (GET /api/disputes/lines).

The per-AWB list ops files with carriers. Same source + honesty rules as the
claimable KPI: rows from reconciliation_disputes, ALWAYS filtered to priced
(applied rate > 0) lines whose rate difference clears the ≥ min_diff floor,
reconciliation_at basis. Unpriced rows are never listed (they can't be disputed)
but their count is surfaced so nothing is hidden.
"""

from typing import Literal

from pydantic import BaseModel


class DisputeLine(BaseModel):
    awb: str
    invoice_no: str | None = None
    courier: str  # display name (reconciliation_disputes.courier)
    courier_slug: str  # derived (normalized) — the tool returns only the name
    order_date: str | None = None  # YYYY-MM-DD (time trimmed)
    is_rto: bool = False  # forward leg (False) vs RTO leg (True)
    applied_weight_kg: float
    invoiced_weight_kg: float
    weight_diff_kg: float
    applied_rate: float  # applied_shipping_rate (> 0 by construction)
    invoiced_rate: float  # invoiced_shipping_rate
    rate_diff: float
    status: str  # recon_status ("Disputed" → "Unreconciled", per project rule)


class DisputeLinesResponse(BaseModel):
    lines: list[DisputeLine] = []  # current page only
    total_matched: int = 0  # priced ≥min_diff lines matching the current filter
    claimable_amount: float = 0.0  # Σ rate_diff over the filtered set
    excluded_no_applied_rate: int = 0  # unpriced lines excluded (count) at this threshold
    couriers: list[str] = []  # distinct courier names (drives the filter dropdown)
    page: int = 1
    page_size: int = 50
    min_diff: float = 50.0
    sort_by: str = "rate_diff"
    date_field: str = "reconciliation_at"
    source: Literal["live", "mock"] = "mock"
    # Warm-cache state (the enumeration runs off the request path, like claimable).
    computing: bool = False
    recalculating: bool = False


class DisputeInvoiceGroup(BaseModel):
    """One carrier invoice = a bundle of dispute lines. Totals are summed from the
    SAME enumerated priced lines as the flat view, so Σ(rate_diff_total) equals the
    claimable KPI exactly (never from reconciliation_summary, which is capped and
    counts non-disputed lines too)."""

    invoice_no: str
    courier: str
    line_count: int
    rate_diff_total: float  # claimable for this invoice
    date_from: str | None = None  # earliest order_date of its lines
    date_to: str | None = None  # latest order_date of its lines


class DisputeInvoicesResponse(BaseModel):
    invoices: list[DisputeInvoiceGroup] = []  # current page only
    total_matched: int = 0  # number of invoices matching the filter
    claimable_amount: float = 0.0  # Σ over ALL filtered invoices == flat claimable
    excluded_no_applied_rate: int = 0
    couriers: list[str] = []
    page: int = 1
    page_size: int = 25
    min_diff: float = 50.0
    date_field: str = "reconciliation_at"
    source: Literal["live", "mock"] = "mock"
    computing: bool = False
    recalculating: bool = False
