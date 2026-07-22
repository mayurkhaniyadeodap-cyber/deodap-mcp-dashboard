"""Delivery SLA performance contract (GET /api/sla-performance).

All fields are LIVE values from the Ship MCP `sla_performance` tool. On MCP failure
the response is source="unavailable" with zeros — never fabricated numbers.
"""

from typing import Literal

from pydantic import BaseModel


class SlaResponse(BaseModel):
    delivered: int = 0  # total delivered shipments in the window
    on_time: int = 0  # delivered on/before promised EDD
    late: int = 0  # delivered after promised EDD
    on_time_pct: float = 0.0  # on_time / delivered * 100
    avg_delay_days: float = 0.0  # average delay on late deliveries
    overdue_in_transit: int = 0  # still in transit and past promised EDD
    source: Literal["live", "mock", "unavailable"] = "mock"
    date_field: str = "order_date"
