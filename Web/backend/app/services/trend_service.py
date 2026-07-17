"""Trend service — live via MCP with mock fallback.

  daily: daily_booking_trend (orders + order_value per day; no courier split).
  by_month: per-courier monthly billing — shipping_cost_summary(group_by=courier)
    once per month window derived from the range (concurrency-capped). The newest
    month is partial (marked). A failed month is skipped (gap), never fatal.
The slow cumulative "rate difference identified" lives in recovery_service.
"""

import asyncio

from app.schemas.trend import TrendDay, TrendResponse
from app.services import live_support, mcp_client
from app.services.courier_service import _name_and_code
from app.services.date_windows import month_windows
from app.utils.mock import load_mock

_cache = live_support.new_cache()
_MAX_COURIERS = 8


def _load_mock() -> TrendResponse:
    return TrendResponse(**load_mock("trend.json"))


async def _month_costs(label: str, ws: str, we: str, sem: asyncio.Semaphore) -> tuple[str, dict[str, float]] | None:
    async with sem:
        try:
            d = live_support.parse_tool_json(
                await mcp_client.call_tool("shipping_cost_summary", {"from": ws, "to": we, "group_by": "courier"})
            )
        except Exception:  # noqa: BLE001 — a failed month is a gap, not fatal
            return None
    costs = {
        _name_and_code(str(b.get("group")))[0]: round(float(b.get("total_cost", 0) or 0), 2)
        for b in d.get("breakdown", []) or []
        if b.get("group") and b.get("group") != "(none)"
    }
    return label, costs


async def _fetch_live(date_from: str | None, date_to: str | None) -> TrendResponse:
    args = live_support.date_args(date_from, date_to)

    daily_raw = live_support.parse_tool_json(
        await mcp_client.call_tool("daily_booking_trend", args)
    )
    daily = [
        TrendDay(day=str(d.get("day", ""))[:10], orders=int(d.get("orders", 0) or 0),
                 order_value=round(float(d.get("order_value", 0) or 0), 2))
        for d in daily_raw.get("days", []) or []
    ]

    windows = month_windows(date_from, date_to)
    partial_by_label = {w[0]: w[3] for w in windows}
    sem = asyncio.Semaphore(4)
    results = await asyncio.gather(*[_month_costs(lbl, ws, we, sem) for lbl, ws, we, _ in windows])

    totals: dict[str, float] = {}
    month_costs: dict[str, dict[str, float]] = {}
    for r in results:
        if r is None:
            continue
        label, costs = r
        month_costs[label] = costs
        for courier, c in costs.items():
            totals[courier] = totals.get(courier, 0) + c

    couriers = [c for c, _ in sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:_MAX_COURIERS]]
    by_month: list[dict[str, str | float]] = []
    for label, _ws, _we, _partial in windows:
        if label not in month_costs:
            continue  # failed month → gap (row omitted)
        row: dict[str, str | float] = {"month": label}
        for courier in couriers:
            row[courier] = month_costs[label].get(courier, 0.0)
        by_month.append(row)

    partial_months = [lbl for lbl in month_costs if partial_by_label.get(lbl)]
    window = (
        f"{windows[0][1]} → {windows[-1][2]} · {len(by_month)} month(s)"
        if by_month else "no complete month in range"
    )

    return TrendResponse(
        daily=daily, couriers=couriers, by_month=by_month,
        partial_months=partial_months, window=window, source="live", date_field="order_date",
    )


async def get_trend(date_from: str | None = None, date_to: str | None = None) -> TrendResponse:
    return await live_support.live_or_mock(
        cache=_cache, key=(date_from, date_to), label="trend",
        fetch=lambda: _fetch_live(date_from, date_to), mock=_load_mock,
    )
