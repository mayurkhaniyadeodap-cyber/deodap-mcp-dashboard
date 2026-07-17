"""Discrepancies API contract.

Reshaped in Phase 2 to only what the Ship MCP genuinely exposes:
  - rate_diff: aggregate weight-reconciliation figures (weight_reconciliation_summary).
  - rto / ndr: per-courier rates (rto_analysis / ndr_analysis ÷ order_analytics orders).
Per-AWB weight cases and per-AWB overcharging ₹ do NOT exist and were removed
(not kept as mock). The "Savings Opportunity" panel is a SEPARATE, slow endpoint
(/api/savings-opportunity) so it never blocks this page.
"""

from typing import Literal

from pydantic import BaseModel


class RateDiff(BaseModel):
    """Aggregate weight-reconciliation figures (reconciliation LINES, not AWBs)."""

    reconciliation_lines: int
    weight_overcharged: int
    weight_diff_kg: float
    fwd_rate_diff: float  # only forward is defensible (rto/net count un-invoiced legs as 0)
    reconciled: int
    disputed: int
    has_recon: bool = True


class CourierRate(BaseModel):
    """Per-courier RTO% or NDR% (count ÷ that courier's orders). 0.0 if none."""

    courier: str
    rate_pct: float
    count: int
    orders: int


class DiscrepancyResponse(BaseModel):
    rate_diff: RateDiff
    rto: list[CourierRate]
    ndr: list[CourierRate]
    ndr_orders: int  # canonical NDR count = ndr_analysis.ndr_orders
    ndr_avg_attempts: float
    # Additive provenance meta (drives the Live/Sample badge; flips on fallback).
    source: Literal["live", "mock"] = "mock"
    recon_date_field: str = "reconciliation_at"  # rate_diff
    order_date_field: str = "order_date"  # rto / ndr
