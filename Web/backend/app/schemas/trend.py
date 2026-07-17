"""Trend analysis API contract.

Daily orders/value (daily_booking_trend, no courier split) + monthly billing per
courier (shipping_cost_summary per-month window, stitched). The slow cumulative
"rate difference identified" series is a SEPARATE endpoint (/api/trend-recovery).
Month windows are derived from the selected range; the newest month is partial.
"""

from typing import Literal

from pydantic import BaseModel


class TrendDay(BaseModel):
    day: str
    orders: int
    order_value: float


class TrendResponse(BaseModel):
    daily: list[TrendDay]
    # Per-courier monthly billing pivot: each row {"month": "Jul", "<courier>": <total_cost>, ...}.
    couriers: list[str]
    by_month: list[dict[str, str | float]]
    # Month labels that are incomplete (rendered dashed / hollow).
    partial_months: list[str] = []
    # Human description of what the chart actually covers (esp. for short ranges).
    window: str = ""
    source: Literal["live", "mock"] = "mock"
    date_field: str = "order_date"
