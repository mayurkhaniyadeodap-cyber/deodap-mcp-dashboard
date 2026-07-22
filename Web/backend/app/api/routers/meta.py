"""Read-only source metadata for the frontend.

  GET /api/_meta/sources → per-panel data provenance ("live" vs "sample")

This is ADDITIVE metadata only: it does not touch any existing response model.
The frontend fetches it to render Live/Sample badges so the UI never hardcodes
which panels are backed by the live Ship MCP vs. sample data. Static by design —
provenance changes only when the integration changes.
"""

from fastapi import APIRouter

router = APIRouter(tags=["_meta"])

# Panel provenance still consumed by the frontend. Only ONE entry remains read by any
# component — `couriers.comparison` (CouriersPage, DiscrepanciesPage RTO panel, and
# CourierSettingsSection all do `useSourceMeta().data?.couriers?.comparison`).
#
# Every other page now derives its Live/Sample/Unavailable badge from the per-response
# `source` field returned by its own endpoint (dashboard, cod, zones, weight, trend,
# discrepancies, bills), so the previous static entries for those pages were obsolete
# and unread — they have been removed. The endpoint's shape (dict[str, dict[str, str]])
# is unchanged, and every consumer uses optional chaining, so trimming is safe.
_SOURCES: dict[str, dict[str, str]] = {
    "couriers": {
        "comparison": "live",
    },
}


@router.get("/_meta/sources")
def source_metadata() -> dict[str, dict[str, str]]:
    """Per-page/per-panel provenance map used to render Live/Sample badges."""
    return _SOURCES
