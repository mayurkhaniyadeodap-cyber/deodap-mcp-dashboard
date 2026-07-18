"""Couriers service — LIVE via MCP (Phase 2 pilot), with mock fallback.

/api/couriers is the ONE endpoint wired to the live Ship MCP server. It joins
two live tools by courier slug:
  - courier_performance  → shipments + delivery/RTO rates (operational)
  - shipping_cost_summary → per-courier freight / RTO cost (billing)
and maps the result into the EXISTING Courier schema (unchanged field names, so
the frontend renders unchanged).

Resilience: results cache for 60s; on ANY MCP failure or a blank MCP token, the
committed mock JSON is returned so the app never breaks in dev.
"""

import asyncio
import json
import logging
import re
import time
from typing import Any

from app.core.config import settings
from app.schemas.couriers import Courier
from app.services import mcp_client
from app.utils.mock import load_mock

logger = logging.getLogger("courier_service")

_CACHE_TTL_SECONDS = 60.0
# Cache per date-range so different ranges cache separately: {(from,to): (ts, data)}.
_cache: dict[tuple[str | None, str | None], tuple[float, list[Courier]]] = {}

# Pretty names / short codes for the REAL live courier roster (slug -> display).
# Display names are the MCP `shipping_company` labels. A blank / "(none)" slug
# surfaces as "Unassigned" (see _name_and_code). Fallback derives unknowns.
_SLUG_NAME = {
    "blue_dart": "BlueDart", "dtdc": "DTDC", "ekart": "Ekart", "trackon": "Trackon",
    "maruti": "Shree Maruti", "amazon_ats": "Amazon ATS", "delhivery": "Delhivery",
    "ship_rocket": "ShipRocket", "india_post": "India Post", "rapid_miles": "Rapid Miles",
    "shree_anjani": "Shree Anjani", "mahavir": "Shree Mahavir",
}
_SLUG_CODE = {
    "blue_dart": "BLD", "dtdc": "DTDC", "ekart": "EKT", "trackon": "TRK", "maruti": "MRT",
    "amazon_ats": "AMZ", "delhivery": "DLV", "ship_rocket": "SR", "india_post": "INP",
    "rapid_miles": "RPM", "shree_anjani": "SAJ", "mahavir": "MHV",
}
# Blank / null / "(none)" courier slug → this label.
_UNASSIGNED = ("Unassigned", "UNA")


def _load_mock_couriers() -> list[Courier]:
    return [Courier(**row) for row in load_mock("couriers.json")]


def _parse_tool_json(result: Any) -> dict:
    """Extract the JSON payload from an MCP CallToolResult (text content block)."""
    for block in getattr(result, "content", []) or []:
        if getattr(block, "type", None) == "text":
            return json.loads(block.text)
    structured = getattr(result, "structuredContent", None)
    if structured:
        return structured
    raise ValueError("MCP tool returned no JSON content")


def _name_and_code(slug: str) -> tuple[str, str]:
    if not slug or slug.strip().lower() in ("(none)", "none", "null", "unassigned"):
        return _UNASSIGNED
    name = _SLUG_NAME.get(slug) or slug.replace("_", " ").title()
    code = _SLUG_CODE.get(slug) or "".join(w[0] for w in name.split())[:3].upper() or slug[:3].upper()
    return name, code


def _norm(name: str) -> str:
    """Normalize a courier display name for joining across tools that label the
    same courier slightly differently (e.g. "Ekart" vs "Ekart Logistics")."""
    n = (name or "").lower()
    for w in ("logistics", "courier"):
        n = n.replace(w, "")
    return re.sub(r"[^a-z0-9]", "", n)


def _map_courier(perf: dict, cost: dict, rto_pct: float, cod_value: float,
                 remitted: float | None) -> dict:
    """Map a joined (performance + cost) row to Courier fields — all LIVE.

    No derived surcharges/rating/recon status (those were fabricated). "Total
    Billed" is freight + rto, computed on the frontend. `remitted` is the live
    per-courier COD remittance (cod_remittance_aging); None when the courier has
    no remittance record → the UI shows "N/A".
    """
    slug = perf.get("courier_slug", "")
    shipments = int(perf.get("total", 0) or 0)
    delivery = float(perf.get("delivery_rate_pct", 0) or 0)
    freight = round(float(cost.get("fwd_cost", 0) or 0), 2)
    rto_amt = round(float(cost.get("rto_cost", 0) or 0), 2)
    avg_cost = round(float(cost.get("avg_cost") or ((freight + rto_amt) / shipments if shipments else 0)), 2)

    name, code = _name_and_code(slug)
    return {
        "name": name, "code": code, "shipments": shipments, "avg_cost": avg_cost,
        "on_time_pct": round(delivery, 2), "total_billing": freight,
        "rto_pct": round(rto_pct, 2), "cod_value": round(cod_value, 2),
        "freight": freight, "rto": rto_amt,
        "remitted": None if remitted is None else round(remitted, 2),
    }


def _date_args(date_from: str | None, date_to: str | None) -> dict:
    """Map the frontend from/to to the MCP tool's date params.

    The Ship courier tools (`courier_performance`, `shipping_cost_summary`) name
    their date-range params literally `from` / `to` (discovered from the tool
    inputSchema during the pilot). If both are absent we send no date args, so
    the server keeps its default last-30-days behaviour.
    """
    args: dict = {}
    if date_from:
        args["from"] = date_from
    if date_to:
        args["to"] = date_to
    return args


async def _fetch_live(date_from: str | None, date_to: str | None) -> list[Courier]:
    date_args = _date_args(date_from, date_to)
    perf_raw, cost_raw, rto_raw, oa_raw, aging_raw = await asyncio.gather(
        mcp_client.call_tool("courier_performance", {**date_args}),
        mcp_client.call_tool("shipping_cost_summary", {"group_by": "courier", **date_args}),
        mcp_client.call_tool("rto_analysis", {**date_args}),
        mcp_client.call_tool("order_analytics", {"group_by": "courier", **date_args}),
        mcp_client.call_tool("cod_remittance_aging", {"group_by": "courier", **date_args}),
    )

    perf_rows = _parse_tool_json(perf_raw).get("couriers", []) or []
    cost_by_slug = {b.get("group"): b for b in _parse_tool_json(cost_raw).get("breakdown", []) or []}
    # Real RTO rate = rto_analysis.count ÷ order_analytics.orders (matches the
    # Discrepancies RTO panel); courier_performance.rto_rate_pct is a different,
    # far smaller number so it is NOT used.
    rto_count = {c.get("value"): int(c.get("count", 0) or 0) for c in _parse_tool_json(rto_raw).get("by_courier", []) or []}
    oa_by_slug = {b.get("group"): b for b in _parse_tool_json(oa_raw).get("breakdown", []) or []}
    # Live per-courier COD remitted. cod_remittance_aging groups by DISPLAY name,
    # so join on the normalized name. Absent courier → None → "N/A" (never faked).
    remitted_by_norm = {
        _norm(b.get("group", "")): float(b.get("remitted", 0) or 0)
        for b in _parse_tool_json(aging_raw).get("breakdown", []) or []
    }

    mapped = []
    for p in perf_rows:
        slug = p.get("courier_slug")
        oa = oa_by_slug.get(slug, {})
        orders = int(oa.get("orders", 0) or 0)
        rto_pct = round(rto_count.get(slug, 0) / orders * 100, 2) if orders else 0.0
        cod_value = float(oa.get("cod_value", 0) or 0)
        name, _code = _name_and_code(slug)
        remitted = remitted_by_norm.get(_norm(name))
        mapped.append(_map_courier(p, cost_by_slug.get(slug, {}), rto_pct, cod_value, remitted))
    mapped.sort(key=lambda c: c["freight"] + c["rto"], reverse=True)
    return [Courier(id=i, **row) for i, row in enumerate(mapped, start=1)]


async def list_couriers(
    date_from: str | None = None, date_to: str | None = None
) -> list[Courier]:
    """Per-courier stats. Live via MCP for the given range (60s cache per range);
    mock on failure/blank token. Absent from/to keeps the last-30-days default."""
    key = (date_from, date_to)
    now = time.monotonic()
    cached = _cache.get(key)
    if cached is not None and (now - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    if not settings.mcp_connect_url:
        logger.warning("MCP not configured (blank MCP_URL/MCP_TOKEN) — using mock couriers")
        return _load_mock_couriers()

    try:
        couriers = await _fetch_live(date_from, date_to)
        if not couriers:
            raise ValueError("MCP returned no couriers")
        _cache[key] = (now, couriers)
        logger.info("Loaded %d couriers from live MCP (from=%s to=%s)", len(couriers), date_from, date_to)
        return couriers
    except Exception as exc:  # noqa: BLE001 — never break the app in dev
        logger.warning("Live MCP courier fetch failed (%s) — falling back to mock", exc)
        return _load_mock_couriers()
