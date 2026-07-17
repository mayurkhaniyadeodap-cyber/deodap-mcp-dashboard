"""Savings-opportunity API contract (separate, slow, 30-min cached endpoint).

Per-AWB "cheapest serviceable courier vs the courier actually used", priced live
from pincode_serviceability. This is a THEORETICAL maximum — it ignores SLA,
capacity and the deliberate routing rules (shipping_rules), so the cheapest
courier's RTO% is shown alongside to make the trade-off visible.
"""

from typing import Literal

from pydantic import BaseModel


class SavingRow(BaseModel):
    awb: str
    courier_used: str
    applied: float  # applied_courier_rate (all-in, incl GST)
    cheapest_courier: str
    cheapest_rate: float  # cheapest serviceable fwd_billed, grossed +18% GST to compare like-for-like
    saving: float
    cheapest_rto_pct: float  # cheapest courier's RTO% — cheaper ≠ better overall


class SavingsResponse(BaseModel):
    rows: list[SavingRow]
    sampled: int  # AWBs successfully priced
    skipped: int  # AWBs whose pricing call failed / had no serviceable rate
    total_saving: float  # sampled saving ONLY — not extrapolated to a monthly figure
    source: Literal["live", "mock"] = "mock"
    note: str = "Theoretical maximum — ignores SLA, capacity and routing rules."
