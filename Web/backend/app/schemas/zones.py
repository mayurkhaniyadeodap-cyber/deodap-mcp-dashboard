"""State Analysis API contract (formerly Zones).

There is no "zone" dimension in the Ship MCP (group_by allows only
state/city/pincode; rate_summary.zone_name is unusable free-text). So this is
per-STATE: shipping cost (shipping_cost_summary group_by=state) joined with
delivery performance (geo_performance group_by=state), after canonicalizing the
dirty raw state labels (codes, pincodes, misspellings) to real Indian states.
"""

from typing import Literal

from pydantic import BaseModel


class StateRow(BaseModel):
    state: str
    orders: int
    total_cost: float
    avg_cost: float
    fwd_cost: float
    rto_cost: float
    delivery_rate_pct: float
    rto_rate_pct: float
    ndr_rate_pct: float
    avg_delivery_days: float
    # True only when BOTH cost and performance data were present for the state.
    joined: bool = True


class ZonesResponse(BaseModel):
    states: list[StateRow]
    # Canonical states present in only ONE tool (shown with blank metrics, not dropped).
    unjoined: list[str] = []
    # Sample of raw labels that didn't resolve to a known state (rolled into "Unknown").
    unmapped: list[str] = []
    unmapped_count: int = 0
    # Additive provenance meta (drives the Live/Sample badge; flips on fallback).
    source: Literal["live", "mock"] = "mock"
    date_field: str = "order_date"
