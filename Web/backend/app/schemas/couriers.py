"""Couriers API contract — only real, live per-courier fields.

Removed the fabricated Phase-1 columns (fuel = freight×0.14, cod = freight×0.02,
cod_remitted, net_payable, an invented rating, and a heuristic recon_status) —
none had an MCP source. "Cost (our rate card)" is derived on the frontend as
freight + rto so it reconciles with the dashboard Total Cost KPI.
"""

from pydantic import BaseModel


class Courier(BaseModel):
    id: int
    name: str
    code: str
    shipments: int  # courier_performance.total
    avg_cost: float  # shipping_cost_summary.avg_cost
    on_time_pct: float  # courier_performance.delivery_rate_pct
    total_billing: float  # = freight (fwd_cost); kept for the export catalog
    rto_pct: float  # rto_analysis.count ÷ order_analytics.orders (matches Discrepancies)
    cod_value: float  # order_analytics.cod_value per courier
    freight: float  # shipping_cost_summary.fwd_cost
    rto: float  # shipping_cost_summary.rto_cost
