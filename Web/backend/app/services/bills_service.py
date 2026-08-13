"""Bills service — live via MCP (list_orders) with mock fallback.

list_orders is genuinely per-order, so the default listing (date range + status
filter + pagination) is served LIVE, mapped into the existing Bill/Page shape.
Free-text search and arbitrary column sort aren't supported by the tool, so those
requests fall back to the existing mock (which does support them) — that keeps
every table feature working and the response shape byte-identical.
"""

import copy
import logging
import math

from app.schemas.bills import Bill, BillStatus
from app.schemas.common import Page
from app.services import live_support, mcp_client
from app.services.courier_service import _SLUG_NAME, _name_and_code
from app.services.zone_service import _CANON
from app.utils.mock import load_mock

logger = logging.getLogger("live")

# Fields the client may sort by.
_SORTABLE = {"date", "amount", "weight", "cod", "courier", "awb", "zone", "status"}
_cache = live_support.new_cache()

# Ship order_status → our BillStatus.
_STATUS_TO_BILL = {
    "delivered": "delivered",
    "intransit": "in_transit",
    "in_transit": "in_transit",
    "rto": "rto",
    "ndr": "discrepancy",
}
# BillStatus filter → Ship order_status query value.
_BILL_TO_ORDER_STATUS = {
    "delivered": "Delivered",
    "in_transit": "InTransit",
    "rto": "RTO",
    "discrepancy": "NDR",
    "pending": "New",
}


def _all_bills() -> list[Bill]:
    return [Bill(**row) for row in load_mock("bills.json")]


def _matches_search(bill: Bill, query: str) -> bool:
    q = query.lower()
    return q in bill.awb.lower() or q in bill.courier.lower() or q in bill.zone.lower()


# --- Live search routing -----------------------------------------------------
# list_orders can't do free-text search, but it DOES filter natively by:
#   awb (exact) · courier_slug (exact slug, case-insensitive) · customer_state (partial).
# Routing the single search box to the right native filter makes search work across ALL
# pages + statuses on LIVE data (the MCP does the filtering, paging, and counting).
_STATE_NAMES_LOWER = tuple(s.lower() for s in _CANON)


def _looks_like_state(term: str) -> bool:
    """True when the term is a (partial) match of a canonical state name — so it routes
    to the native customer_state filter rather than a same-spelled courier (e.g. the
    zone "Delhi" vs the courier "Delhivery")."""
    t = term.strip().lower()
    return bool(t) and any(t in s for s in _STATE_NAMES_LOWER)


def _resolve_courier_slug(term: str) -> str | None:
    """Courier slug when `term` matches exactly ONE known courier (by slug or display
    name, case-insensitive substring); None when it is ambiguous or unknown."""
    t = term.strip().lower()
    hits = {slug for slug, name in _SLUG_NAME.items() if t in slug.lower() or t in name.lower()}
    return next(iter(hits)) if len(hits) == 1 else None


def _search_filter(term: str | None) -> dict:
    """Map the search box to ONE native list_orders filter. Precedence: a digit run is an
    AWB (exact); a state name/prefix is a zone (partial, native); an unambiguous courier
    name is a courier_slug; otherwise a partial state match. Empty term → no filter."""
    t = (term or "").strip()
    if not t:
        return {}
    if t.isdigit() and len(t) >= 4:
        return {"awb": t}
    if not _looks_like_state(t):
        slug = _resolve_courier_slug(t)
        if slug:
            return {"courier_slug": slug}
    return {"customer_state": t}


def _sort_key(bill: Bill, field: str):
    value = getattr(bill, field)
    return value.value if isinstance(value, BillStatus) else value


def _map_order(o: dict) -> dict:
    awb = o.get("awb") or o.get("rt_awb") or o.get("order_no") or str(o.get("id"))
    order_date = str(o.get("order_date") or "")[:10] or "2026-01-01"
    courier = o.get("shipping_company") or o.get("courier_name") or _name_and_code(o.get("courier_slug", ""))[0]
    weight = float(o.get("total_weight_kg") or o.get("actual_weight_kg") or 0)
    amount = float(o.get("applied_courier_rate") or o.get("order_total") or 0)
    cod = float(o.get("cod_total") or 0)
    zone = o.get("customer_state") or ""
    status = _STATUS_TO_BILL.get(str(o.get("status", "")).lower().replace(" ", ""), "pending")
    return {
        "id": int(o.get("id", 0)), "awb": awb, "courier": courier, "date": order_date,
        "weight": round(weight, 2), "zone": zone, "amount": round(amount, 2),
        "cod": round(cod, 2), "status": status,
    }


def _mock_page(*, search, status, sort, page, page_size, date_from, date_to,
               source: str = "sample") -> Page[Bill]:
    """Filtered/sorted/paged view over committed demo bills. ALWAYS labeled
    source="sample" (default) so it can never be shown under a LIVE badge."""
    items = _all_bills()
    if date_from:
        items = [b for b in items if b.date.isoformat() >= date_from]
    if date_to:
        items = [b for b in items if b.date.isoformat() <= date_to]
    if search:
        items = [b for b in items if _matches_search(b, search)]
    if status is not None:
        items = [b for b in items if b.status == status]
    if sort:
        field, _, direction = sort.partition(":")
        if field in _SORTABLE:
            items = sorted(items, key=lambda b: _sort_key(b, field), reverse=direction == "desc")
    total = len(items)
    total_pages = max(1, math.ceil(total / page_size))
    page = min(max(page, 1), total_pages)
    start = (page - 1) * page_size
    return Page(items=items[start : start + page_size], total=total, page=page,
                page_size=page_size, total_pages=total_pages, source=source)


def _unavailable_page(*, page, page_size) -> Page[Bill]:
    """Live fetch failed → an EMPTY page marked unavailable. Never fabricated bills."""
    return Page(items=[], total=0, page=max(page, 1), page_size=page_size,
                total_pages=1, source="unavailable")


async def _fetch_live(*, search_filter=None, status, page, page_size, date_from, date_to) -> Page[Bill]:
    args = live_support.date_args(date_from, date_to)
    if search_filter:  # native list_orders filter (awb / courier_slug / customer_state)
        args.update(search_filter)
    args["limit"] = page_size
    args["offset"] = (max(page, 1) - 1) * page_size
    if status is not None:
        args["status"] = _BILL_TO_ORDER_STATUS.get(status.value, None)
    raw = live_support.parse_tool_json(await mcp_client.call_tool("list_orders", args))
    orders = raw.get("orders", []) or []
    total = int(raw.get("total_matched", len(orders)) or 0)
    total_pages = max(1, math.ceil(total / page_size)) if total else 1
    items = [Bill(**_map_order(o)) for o in orders]
    return Page(items=items, total=total, page=max(page, 1), page_size=page_size,
                total_pages=total_pages, source="live")


async def list_bills(
    *,
    search: str | None = None,
    status: BillStatus | None = None,
    sort: str | None = None,
    page: int = 1,
    page_size: int = 10,
    date_from: str | None = None,
    date_to: str | None = None,
) -> Page[Bill]:
    # SEARCH is served LIVE: list_orders filters natively by awb / courier_slug /
    # customer_state, so the search box works across ALL pages + statuses on live data
    # (the MCP does the filtering, paging and counting). Only an arbitrary COLUMN SORT
    # stays unsupported by the tool → that path still falls back to committed demo data,
    # labeled source="sample" so it NEVER appears under a LIVE badge.
    search_filter = _search_filter(search)
    non_default_sort = sort is not None and sort not in ("date:desc", "date")
    if non_default_sort:
        return _mock_page(search=search, status=status, sort=sort, page=page,
                          page_size=page_size, date_from=date_from, date_to=date_to,
                          source="sample")

    # Live path. On MCP failure return an EMPTY, source="unavailable" page — never fake
    # bills under a live badge. Dev may opt into fixtures (labeled "sample") via the
    # USE_MOCK_FALLBACK flag, mirroring every other service.
    def _fallback() -> Page[Bill]:
        if live_support.settings.use_mock_fallback:
            return _mock_page(search=search, status=status, sort=sort, page=page,
                              page_size=page_size, date_from=date_from, date_to=date_to,
                              source="sample")
        return _unavailable_page(page=page, page_size=page_size)

    key = (date_from, date_to, status.value if status else None, page, page_size,
           tuple(sorted(search_filter.items())))
    return await live_support.live_or_mock(
        cache=_cache, key=key, label="bills",
        fetch=lambda: _fetch_live(search_filter=search_filter, status=status, page=page,
                                  page_size=page_size, date_from=date_from, date_to=date_to),
        mock=_fallback,
    )
