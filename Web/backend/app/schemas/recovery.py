"""Cumulative "rate difference identified" API contract (separate slow endpoint).

Per-month weight_reconciliation_summary.fwd_rate_diff, cumulatively summed. This
is money IDENTIFIED (courier over-invoiced vs our applied rate) — NOT recovered;
true recovery needs dispute-outcome tracking (Phase 3). The newest month is
partial (reconciliation lags) → flatter tail, marked so it doesn't read as
"solved". A failed month is a gap, not a whole-chart failure.
"""

from typing import Literal

from pydantic import BaseModel


class RecoveryPoint(BaseModel):
    month: str
    identified: float  # that month's fwd_rate_diff (0 for a gap)
    cumulative: float
    partial: bool = False  # incomplete month (reconciliation still arriving)
    gap: bool = False  # the month's MCP call failed — value unknown, not zero


class RecoveryResponse(BaseModel):
    points: list[RecoveryPoint]
    source: Literal["live", "mock"] = "mock"
    date_field: str = "reconciliation_at"
