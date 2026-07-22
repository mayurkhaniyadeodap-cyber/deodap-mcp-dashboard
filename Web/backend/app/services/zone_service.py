"""State Analysis service — live via MCP with mock fallback.

Joins shipping_cost_summary(group_by=state) [orders, fwd/rto/total cost] with
geo_performance(group_by=state, limit=500) [delivery/RTO/NDR rates, avg days]
on a CANONICALIZED state name. Raw labels are filthy (state codes, pincodes,
trailing commas, misspellings), so we normalize + alias-map to real Indian
states and aggregate. Nothing is silently dropped: labels that don't resolve to
a known state roll into an "Unknown" row and are reported; states present in
only one tool are kept with blank metrics and listed in `unjoined`.
"""

import asyncio
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
    # --- Extended aliases: verified genuine state-name variants recovered from the
    # "Unknown" bucket (misspellings, missing letters, legacy UT names, ", India"
    # suffixes). Keys are the _canon_state normalized-UPPER form (non-alpha stripped,
    # & -> AND, spaces collapsed). ONLY real state variants — never cities/garbage
    # (Mumbai, Hyderabad, pincodes, "School" … deliberately stay Unknown). ---
    "MAHARASTRA": "Maharashtra", "MAHARASTHRA": "Maharashtra", "MAHARASHTR": "Maharashtra",
    "MAHARASHTRAA": "Maharashtra", "MAHARSHTRA": "Maharashtra", "MAARASTRA": "Maharashtra",
    "MAHHARASTRA": "Maharashtra", "MAHARATRA": "Maharashtra", "MAHASTRA": "Maharashtra",
    "MAHARRASHTRA": "Maharashtra", "MAHARAHTRA": "Maharashtra", "MAHRASHTRA": "Maharashtra",
    "MAHARAEHTRA": "Maharashtra", "MAHARAHSTRA": "Maharashtra", "MAHRASTRA": "Maharashtra",
    "KERELA": "Kerala", "KERLA": "Kerala", "KERAL": "Kerala", "KERLALA": "Kerala", "KARALA": "Kerala",
    "KARNATAK": "Karnataka", "KARNATKA": "Karnataka", "KARNATAKHA": "Karnataka",
    "UTTARPRADESH": "Uttar Pradesh", "UTTER PRADESH": "Uttar Pradesh", "UTTAR PARDESH": "Uttar Pradesh",
    "UTTAAR PRADESH": "Uttar Pradesh", "UTTARPADESH": "Uttar Pradesh", "UTTAR PRADES": "Uttar Pradesh",
    "UTTERPRADESH": "Uttar Pradesh", "UTTERPARDESH": "Uttar Pradesh", "U P": "Uttar Pradesh",
    "TTAR PRADESH": "Uttar Pradesh", "UTTAR PRADESH INDIA": "Uttar Pradesh",
    "UTTRAKHAND": "Uttarakhand", "UTRAKHAND": "Uttarakhand", "UTTRA KHAND": "Uttarakhand",
    "WEST BANGAL": "West Bengal", "WESTBANGAL": "West Bengal", "WESTBENGAL": "West Bengal",
    "WEST BAANGAL": "West Bengal", "WES BANGAL": "West Bengal", "WEST BENGA": "West Bengal",
    "WEST BENGALL": "West Bengal", "EST BENGAL": "West Bengal", "WEST BENGAL INDIA": "West Bengal",
    "MADHYAPRADESH": "Madhya Pradesh", "MADHYPRADHESH": "Madhya Pradesh", "MADHYAPRAESH": "Madhya Pradesh",
    "MADHYA PRADDESH": "Madhya Pradesh", "MADHYA PREADESH": "Madhya Pradesh", "MADYAPRADESH": "Madhya Pradesh",
    "MADHYA PARDESH": "Madhya Pradesh",
    "PANJAB": "Punjab",
    "TELAGANA": "Telangana", "TELEGHANA": "Telangana", "ELANGANA": "Telangana",
    "TELANGANAQ": "Telangana", "TELANGANA TG": "Telangana",
    "CHATTISGARH": "Chhattisgarh", "CHHATISGARDH": "Chhattisgarh", "CHHATISHGARDH": "Chhattisgarh",
    "CHATISGARH": "Chhattisgarh", "CHAATTISGARH": "Chhattisgarh", "CHHATTISHGARH": "Chhattisgarh",
    "CHANDIGARDH": "Chandigarh",
    "RAJASTHA": "Rajasthan", "RAJSTHAN": "Rajasthan", "RAJISTHAN": "Rajasthan",
    "RAJASHTHAN": "Rajasthan", "RAJESTHAN": "Rajasthan", "RAJASTHAN INDIA": "Rajasthan",
    "HARIYANA": "Haryana", "HARAYANA": "Haryana", "HARYAN": "Haryana",
    "BIHAR INDIA": "Bihar", "BIHAR X": "Bihar",
    "AASAM": "Assam", "ODISA": "Odisha", "ODISHA INDIA": "Odisha",
    "JHARKAND": "Jharkhand", "JHARKHAND X": "Jharkhand", "MEGHALYA": "Meghalaya",
    "HIMACHALPRADESH": "Himachal Pradesh", "HIMANCHALPRADESH": "Himachal Pradesh",
    "HIMANCHAL PRADESH": "Himachal Pradesh", "HIMACHAL PRDESH": "Himachal Pradesh",
    "JAMMU KASHMIR": "Jammu And Kashmir", "J AND K": "Jammu And Kashmir",
    "AMMU AND KASHMIR": "Jammu And Kashmir", "J AND KASHMIR": "Jammu And Kashmir",
    "ANDHRA PRADSH": "Andhra Pradesh", "NDHRA PRADESH": "Andhra Pradesh",
    "TAMILNARU": "Tamil Nadu", "TMIL NADU": "Tamil Nadu", "AMIL NADU": "Tamil Nadu",
    "TAMILNAADU": "Tamil Nadu", "TAMIL NADU INDIA": "Tamil Nadu",
    "DEHLI": "Delhi", "NEW DEHLI": "Delhi", "DELHI DELHI": "Delhi", "NEW DELHI DELHI": "Delhi",
    "UJARAT": "Gujarat", "SIKLKIM": "Sikkim",
    "ANDAMAN ANDAMAN AND NICOBAR ISLANDS": "Andaman And Nicobar Islands",
    "DADRA AND NAGAR HAVELI": "Dadra And Nagar Haveli And Daman And Diu",
    "DAMAN AND DIU": "Dadra And Nagar Haveli And Daman And Diu",
    "DADRA AND NAGAR": "Dadra And Nagar Haveli And Daman And Diu",
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
    # Honest "unavailable" (empty) by default — fixtures only in dev (USE_MOCK_FALLBACK).
    if live_support.settings.use_mock_fallback:
        return ZonesResponse(**load_mock("zones.json"))
    return ZonesResponse(states=[], source="unavailable")


async def _fetch_live(date_from: str | None, date_to: str | None) -> ZonesResponse:
    args = live_support.date_args(date_from, date_to)
    # The two tools are independent → fetch concurrently (was sequential ≈ sum of both).
    cost_r, geo_r = await asyncio.gather(
        mcp_client.call_tool("shipping_cost_summary", {**args, "group_by": "state"}),
        mcp_client.call_tool("geo_performance", {**args, "group_by": "state", "limit": 500}),
    )
    cost = live_support.parse_tool_json(cost_r)
    geo = live_support.parse_tool_json(geo_r)

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

    invalid_days: list[str] = []  # areas whose MCP avg_delivery_days is < 0 (invalid)
    for a in geo.get("areas", []) or []:
        c = _canon_state(a.get("area"))
        if c is None:
            unmapped.add(str(a.get("area")))
        key = c or "Unknown"
        o = int(a.get("orders", 0) or 0)
        d = geo_map.setdefault(key, {"orders": 0, "delivered": 0, "rto": 0, "ndr": 0, "daysw": 0.0, "days_orders": 0})
        d["orders"] += o
        d["delivered"] += int(a.get("delivered", 0) or 0)
        d["rto"] += int(a.get("rto", 0) or 0)
        d["ndr"] += int(a.get("ndr", 0) or 0)
        # Avg-days weight: a delivery time cannot be negative. geo_performance can emit
        # an invalid negative avg_delivery_days for an area (observed: raw "Jharkhand"
        # = -293.1 → a source/MCP data error). Exclude such invalid rows from the
        # days-weighted mean (its own `days_orders` denominator) so one bad value can't
        # poison the state's Avg Days. NOT abs()-clamped, NOT hidden (logged below).
        # Orders / delivery-RTO-NDR rates keep the FULL area orders (unchanged).
        avg_days = float(a.get("avg_delivery_days", 0) or 0)
        if avg_days >= 0:
            d["daysw"] += avg_days * o
            d["days_orders"] += o
        else:
            invalid_days.append(str(a.get("area")))

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
            avg_delivery_days=round(g["daysw"] / g["days_orders"], 2) if g and g["days_orders"] else 0.0,
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
    if invalid_days:
        logger.warning(
            "zones: %d geo area(s) had an INVALID negative avg_delivery_days from the MCP "
            "(excluded from Avg Days, not clamped): %s",
            len(invalid_days), sorted(invalid_days),
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
