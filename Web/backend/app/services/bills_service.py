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
from app.services.courier_service import _name_and_code
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


async def _fetch_live(*, status, page, page_size, date_from, date_to) -> Page[Bill]:
    args = live_support.date_args(date_from, date_to)
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
    # Free-text search / non-default sort aren't supported by list_orders (the MCP).
    # Serve those from committed demo data so the FEATURE keeps working, but label it
    # source="sample" — it must NEVER appear under a LIVE badge. Default (date-desc)
    # listing goes live.
    live_capable = not search and (sort is None or sort in ("date:desc", "date"))
    if not live_capable:
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

    key = (date_from, date_to, status.value if status else None, page, page_size)
    return await live_support.live_or_mock(
        cache=_cache, key=key, label="bills",
        fetch=lambda: _fetch_live(status=status, page=page, page_size=page_size,
                                  date_from=date_from, date_to=date_to),
        mock=_fallback,
    )
