"""Read-only source metadata for the frontend.

  GET /api/_meta/sources → per-panel data provenance ("live" vs "sample")

This is ADDITIVE metadata only: it does not touch any existing response model.
The frontend fetches it to render Live/Sample badges so the UI never hardcodes
which panels are backed by the live Ship MCP vs. sample data. Static by design —
provenance changes only when the integration changes.
"""

from fastapi import APIRouter

router = APIRouter(tags=["_meta"])

# Panel provenance. "live" = served from the Ship MCP; "sample" = mock data kept
# because the MCP audit confirmed no shipment-/invoice-level source exists yet.
_SOURCES: dict[str, dict[str, str]] = {
    "dashboard": {
        "kpi_total_billing": "live",
        "kpi_total_shipments": "live",
        "kpi_average_cost": "live",
        "kpi_cod": "live",
        "kpi_pending_reconciliation": "sample",
        "kpi_savings": "sample",
        "courier_chart": "live",
        "shipment_distribution": "live",
        "monthly_billing": "sample",
        "zone_chart": "sample",
        "recent_activity": "sample",
        "recent_bills": "sample",
    },
    "couriers": {
        "comparison": "live",
    },
    "bills": {
        "table": "live",
    },
    "cod": {
        "summary": "live",
        "weekly_chart": "sample",
        "courier_table": "sample",
    },
    "discrepancies": {
        "kpis": "live",
        "rto": "live",
        "weight_cases": "sample",
        "overcharging": "sample",
        "reconciled": "sample",
    },
    "zones": {
        "state_summary": "live",
        "heatmap": "sample",
    },
    "weight": {
        "kpis": "live",
        "scatter": "sample",
        "histogram": "sample",
    },
    "trend": {
        "monthly": "live",
        "courier_breakdown": "sample",
    },
}


@router.get("/_meta/sources")
def source_metadata() -> dict[str, dict[str, str]]:
    """Per-page/per-panel provenance map used to render Live/Sample badges."""
    return _SOURCES
