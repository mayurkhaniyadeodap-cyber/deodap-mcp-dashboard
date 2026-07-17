"""State Analysis service — live via MCP with mock fallback.

Joins shipping_cost_summary(group_by=state) [orders, fwd/rto/total cost] with
geo_performance(group_by=state, limit=500) [delivery/RTO/NDR rates, avg days]
on a CANONICALIZED state name. Raw labels are filthy (state codes, pincodes,
trailing commas, misspellings), so we normalize + alias-map to real Indian
states and aggregate. Nothing is silently dropped: labels that don't resolve to
a known state roll into an "Unknown" row and are reported; states present in
only one tool are kept with blank metrics and listed in `unjoined`.
"""

import logging
import re

from app.schemas.zones import StateRow, ZonesResponse
from app.services import live_support, mcp_client
from app.utils.mock import load_mock

logger = logging.getLogger("live")
_cache = live_support.new_cache()

# Canonical Indian states + UTs (title-cased; "and" lowercased by .title() → "And").
_CANON = {
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
    "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman And Nicobar Islands", "Chandigarh", "Dadra And Nagar Haveli And Daman And Diu",
    "Delhi", "Jammu And Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
}
# normalized-UPPER label -> canonical (codes + common misspellings).
_ALIAS = {
    "AP": "Andhra Pradesh", "ANDHRAPRADESH": "Andhra Pradesh", "ANDRA PRADESH": "Andhra Pradesh",
    "ANDHRA PRADES": "Andhra Pradesh", "ANDRAPRADESH": "Andhra Pradesh",
    "AR": "Arunachal Pradesh", "ARUNCHAL PRADESH": "Arunachal Pradesh", "ARUNCHALPRADESH": "Arunachal Pradesh",
    "AS": "Assam", "BR": "Bihar", "CG": "Chhattisgarh", "CT": "Chhattisgarh", "CHHATISGARH": "Chhattisgarh",
    "GA": "Goa", "GJ": "Gujarat", "GUJRAT": "Gujarat",
    "HR": "Haryana", "HP": "Himachal Pradesh", "JH": "Jharkhand",
    "KA": "Karnataka", "KL": "Kerala", "KEARLA": "Kerala",
    "MP": "Madhya Pradesh", "MH": "Maharashtra", "MN": "Manipur", "ML": "Meghalaya", "MZ": "Mizoram",
    "NL": "Nagaland", "OD": "Odisha", "OR": "Odisha", "ORISSA": "Odisha",
    "PB": "Punjab", "RJ": "Rajasthan", "SK": "Sikkim",
    "TN": "Tamil Nadu", "TAMILNADU": "Tamil Nadu",
    "TS": "Telangana", "TG": "Telangana", "TELENGANA": "Telangana", "TR": "Tripura",
    "UP": "Uttar Pradesh", "UK": "Uttarakhand", "UA": "Uttarakhand", "UTTARANCHAL": "Uttarakhand",
    "WB": "West Bengal",
    "AN": "Andaman And Nicobar Islands", "ANDAMAN": "Andaman And Nicobar Islands",
    "ANDAMAN AND NICOBAR": "Andaman And Nicobar Islands", "ANDAMAN AND NICOBAR ISLAND": "Andaman And Nicobar Islands",
    "CH": "Chandigarh", "DL": "Delhi", "NEW DELHI": "Delhi",
    "JK": "Jammu And Kashmir", "JAMMU AND KASHMIR": "Jammu And Kashmir",
    "LA": "Ladakh", "LD": "Lakshadweep", "PY": "Puducherry", "PONDICHERRY": "Puducherry",
    "DN": "Dadra And Nagar Haveli And Daman And Diu", "DD": "Dadra And Nagar Haveli And Daman And Diu",
}


def _canon_state(raw: object) -> str | None:
    """Canonicalize a dirty state label to a real state, or None if unresolvable."""
    s = re.sub(r"[^A-Za-z& ]", " ", str(raw or ""))
    s = s.replace("&", " and ")
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return None
    up = s.upper()
    if up in _ALIAS:
        return _ALIAS[up]
    title = s.title()
    if title in _CANON:
        return title
    return None


def _load_mock() -> ZonesResponse:
    return ZonesResponse(**load_mock("zones.json"))


async def _fetch_live(date_from: str | None, date_to: str | None) -> ZonesResponse:
    args = live_support.date_args(date_from, date_to)
    cost = live_support.parse_tool_json(
        await mcp_client.call_tool("shipping_cost_summary", {**args, "group_by": "state"})
    )
    geo = live_support.parse_tool_json(
        await mcp_client.call_tool("geo_performance", {**args, "group_by": "state", "limit": 500})
    )

    cost_map: dict[str, dict] = {}
    geo_map: dict[str, dict] = {}
    unmapped: set[str] = set()

    for b in cost.get("breakdown", []) or []:
        c = _canon_state(b.get("group"))
        if c is None:
            unmapped.add(str(b.get("group")))
        key = c or "Unknown"
        d = cost_map.setdefault(key, {"orders": 0, "fwd": 0.0, "rto": 0.0, "total": 0.0})
        d["orders"] += int(b.get("orders", 0) or 0)
        d["fwd"] += float(b.get("fwd_cost", 0) or 0)
        d["rto"] += float(b.get("rto_cost", 0) or 0)
        d["total"] += float(b.get("total_cost", 0) or 0)

    for a in geo.get("areas", []) or []:
        c = _canon_state(a.get("area"))
        if c is None:
            unmapped.add(str(a.get("area")))
        key = c or "Unknown"
        o = int(a.get("orders", 0) or 0)
        d = geo_map.setdefault(key, {"orders": 0, "delivered": 0, "rto": 0, "ndr": 0, "daysw": 0.0})
        d["orders"] += o
        d["delivered"] += int(a.get("delivered", 0) or 0)
        d["rto"] += int(a.get("rto", 0) or 0)
        d["ndr"] += int(a.get("ndr", 0) or 0)
        d["daysw"] += float(a.get("avg_delivery_days", 0) or 0) * o

    states: list[StateRow] = []
    unjoined: list[str] = []
    for key in set(cost_map) | set(geo_map):
        c = cost_map.get(key)
        g = geo_map.get(key)
        joined = bool(c and g)
        c_orders = c["orders"] if c else 0
        g_orders = g["orders"] if g else 0
        total_cost = c["total"] if c else 0.0
        states.append(StateRow(
            state=key,
            orders=c_orders or g_orders,
            total_cost=round(total_cost, 2),
            avg_cost=round(total_cost / c_orders, 2) if c_orders else 0.0,
            fwd_cost=round(c["fwd"], 2) if c else 0.0,
            rto_cost=round(c["rto"], 2) if c else 0.0,
            delivery_rate_pct=round(g["delivered"] / g_orders * 100, 2) if g and g_orders else 0.0,
            rto_rate_pct=round(g["rto"] / g_orders * 100, 2) if g and g_orders else 0.0,
            ndr_rate_pct=round(g["ndr"] / g_orders * 100, 2) if g and g_orders else 0.0,
            avg_delivery_days=round(g["daysw"] / g_orders, 2) if g and g_orders else 0.0,
            joined=joined,
        ))
        if not joined and key != "Unknown":
            unjoined.append(key)

    states.sort(key=lambda s: s.total_cost, reverse=True)

    if unjoined or unmapped:
        logger.warning(
            "zones: %d state(s) present in only one tool (blank metrics): %s | %d raw label(s) "
            "unmapped→Unknown (e.g. %s)",
            len(unjoined), sorted(unjoined), len(unmapped), sorted(unmapped)[:8],
        )

    return ZonesResponse(
        states=states,
        unjoined=sorted(unjoined),
        unmapped=sorted(unmapped)[:40],
        unmapped_count=len(unmapped),
        source="live",
        date_field="order_date",
    )


async def get_zones(date_from: str | None = None, date_to: str | None = None) -> ZonesResponse:
    return await live_support.live_or_mock(
        cache=_cache, key=(date_from, date_to), label="zones",
        fetch=lambda: _fetch_live(date_from, date_to), mock=_load_mock,
    )
