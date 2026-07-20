"""Reconciliation detail contract (GET /api/discrepancies/reconciliation).

Additive, read-only. Per-AWB weight/rate mismatches from reconciliation_disputes
and per-courier reconciled totals from reconciliation_summary. Empty on mock
fallback — no fabricated AWBs / couriers / amounts.
"""

from typing import Literal

from pydantic import BaseModel


class WeightDispute(BaseModel):
    awb: str
    courier: str
    expected_weight_kg: float  # applied_weight_kg (what we applied)
    billed_weight_kg: float  # invoiced_weight_kg (what the courier billed)
    weight_diff_kg: float
    status: str  # reconciliation_disputes.recon_status


class RateDispute(BaseModel):
    awb: str
    courier: str
    applied_rate: float  # applied_shipping_rate
    invoiced_rate: float  # invoiced_shipping_rate
    rate_diff: float


class ReconciledCourier(BaseModel):
    courier: str
    reconciled_lines: int  # reconciliation_summary.rows (status=Reconciled)
    reconciled_amount: float  # invoiced_rate of reconciled lines


class ReconciliationResponse(BaseModel):
    weight_disputes: list[WeightDispute] = []
    weight_total: int = 0  # total_matched (this is the top-N slice)
    rate_disputes: list[RateDispute] = []
    rate_total: int = 0
    reconciled: list[ReconciledCourier] = []
    source: Literal["live", "mock", "unavailable"] = "mock"
    date_field: str = "order_date"


class ClaimableRateResponse(BaseModel):
    """Claimable rate difference = Σ rate_diff over reconciliation_disputes rows that
    are (a) material (rate_diff ≥ threshold) AND (b) actually priced (applied rate > 0).
    Rows without an applied rate can't be claimed (the whole invoice looks like an
    overcharge) and small diffs are noise — both are surfaced, not hidden."""

    claimable_amount: float = 0.0
    excluded_no_applied_rate: float = 0.0  # ≥ threshold but applied rate = 0 (unpriced)
    excluded_below_threshold: float = 0.0  # positive but < threshold
    count: int = 0  # claimable rows
    threshold: float = 50.0
    source: Literal["live", "mock", "unavailable"] = "mock"
    date_field: str = "reconciliation_at"
    # Warm-cache state (the ~260s enumeration runs on a background schedule, never
    # inline). computing = no result yet (first run pending). recalculating = the
    # figure shown is the last-good one for another/older window while a fresh
    # compute runs in the background.
    computing: bool = False
    recalculating: bool = False
    # True when the selected window is still reconciling (its end is within the
    # reconciliation lag). The figure is real but LOW because most lines haven't been
    # reconciled yet → the UI shows a maturity note, not a bare "settled ₹0".
    maturing: bool = False
