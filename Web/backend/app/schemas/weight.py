"""Weight analysis API contract.

KPIs come from weight_reconciliation_summary — these are RECONCILIATION LINES
(~2 per order: forward + RTO legs), driven by reconciliation_at, and they LAG
(recent ranges return 0). The scatter + slab histogram are a capped SAMPLE of
per-shipment actual-vs-charged weights from list_orders (order_date).
"""

from typing import Literal

from pydantic import BaseModel


class WeightPoint(BaseModel):
    actual: float
    charged: float
    courier: str


class WeightBucket(BaseModel):
    bucket: str
    count: int


class WeightSummary(BaseModel):
    reconciliation_lines: int
    weight_overcharged: int
    weight_diff_kg: float
    # Only the FORWARD rate difference is defensible (rto/net count un-invoiced
    # RTO legs as 0). Positive = courier invoiced more than we applied.
    fwd_rate_diff: float
    reconciled: int
    disputed: int
    # False when the range returned 0 reconciliation lines → show an empty-state,
    # not a misleading ₹0 (reconciliation lags a few days).
    has_recon: bool = True


class WeightResponse(BaseModel):
    scatter: list[WeightPoint]
    histogram: list[WeightBucket]
    summary: WeightSummary
    # Usable shipments in the sample (both weights present); histogram is over ALL
    # of them, the scatter render is capped. total_matched = full population size.
    sample_size: int = 0
    total_matched: int = 0
    is_full: bool = False  # True → the sample IS the whole population ("all N")
    # Data-quality gap: orders with NO recorded actual_weight_kg (can't be weight-
    # audited). Measured across the FULL stride sample, extrapolated as a %.
    sampled_rows: int = 0
    missing_weight_count: int = 0
    missing_weight_pct: float = 0.0
    # Additive provenance meta (drives the Live/Sample badge; flips on fallback).
    source: Literal["live", "mock"] = "mock"
    recon_date_field: str = "reconciliation_at"  # KPIs
    sample_date_field: str = "order_date"  # scatter + histogram
