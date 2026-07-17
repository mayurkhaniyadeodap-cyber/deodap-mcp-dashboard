"""Shared list_orders sampler — deduped, never larger than the population.

Two stride sites (dashboard courier-billing, weight scatter/histogram) had the
same bug: 5 pages of 500 at 0/20/40/60/80% of total_matched OVERLAP when
total_matched is small (e.g. 1,754 → offsets 0/350/701/1052/1403), double-
counting ~600 orders so the "sample" exceeded the population. Fix:
  - total <= page                → the first page is everything.
  - total <= cap (2,500)         → page the WHOLE population sequentially (is_full=True).
  - total > cap                  → stride (step = total//5 >= page, so no overlap), is_full=False.
Always dedupe by order id, and assert the result never exceeds total.
"""

import asyncio

from app.services import live_support, mcp_client


def _dedupe(orders: list[dict]) -> list[dict]:
    seen: set = set()
    out: list[dict] = []
    for o in orders:
        oid = o.get("id")
        if oid in seen:
            continue
        seen.add(oid)
        out.append(o)
    return out


async def sample_orders(
    date_args: dict, *, page: int = 500, cap: int = 2500,
) -> tuple[list[dict], int, bool]:
    """Return (orders_deduped, total_matched, is_full).

    is_full=True means the deduped list IS the whole population (label "all N");
    otherwise it's a stride sample (label "sample of N of M").
    """
    first = live_support.parse_tool_json(
        await mcp_client.call_tool("list_orders", {**date_args, "limit": page, "offset": 0})
    )
    total = int(first.get("total_matched", 0) or 0)
    orders = list(first.get("orders", []) or [])

    if total <= page:
        return _dedupe(orders), total, True

    if total <= cap:
        offsets = list(range(page, total, page))  # sequential → whole population
        is_full = True
    else:
        # stride; step = total//5 >= page (since total > cap == 5*page) → no overlap
        offsets = sorted({min(total - 1, int(total * f)) for f in (0.2, 0.4, 0.6, 0.8)})
        is_full = False

    rest = await asyncio.gather(
        *[mcp_client.call_tool("list_orders", {**date_args, "limit": page, "offset": off}) for off in offsets],
        return_exceptions=True,
    )
    for r in rest:
        if not isinstance(r, Exception):
            orders += live_support.parse_tool_json(r).get("orders", []) or []

    deduped = _dedupe(orders)
    # Guard: a sample can NEVER exceed the population.
    assert len(deduped) <= total, f"sample {len(deduped)} > total_matched {total}"
    return deduped, total, is_full
