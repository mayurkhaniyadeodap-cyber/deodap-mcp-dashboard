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
_OTHER_LABEL = "Other"  # aggregates couriers beyond the top-8 + the "(none)" bucket
_NONE_KEY = "(none)"    # unassigned-courier costs, kept for the "Other" roll-up


def _load_mock() -> TrendResponse:
    # Honest "unavailable" (empty) by default — fixtures only in dev (USE_MOCK_FALLBACK).
    if live_support.settings.use_mock_fallback:
        return TrendResponse(**load_mock("trend.json"))
    return TrendResponse(daily=[], couriers=[], by_month=[], source="unavailable")


async def _month_costs(label: str, ws: str, we: str, sem: asyncio.Semaphore) -> tuple[str, dict[str, float] | None]:
    """Return (label, per-courier cost dict) for one month, or (label, None) if the MCP
    call failed — the label is kept either way so a failed month is surfaced, not dropped.
    "(none)"/unassigned costs are kept under _NONE_KEY so they roll into the "Other" bucket."""
    async with sem:
        try:
            d = live_support.parse_tool_json(
                await mcp_client.call_tool("shipping_cost_summary", {"from": ws, "to": we, "group_by": "courier"})
            )
        except Exception:  # noqa: BLE001 — a failed month is surfaced (gap), not fatal
            return label, None
    costs: dict[str, float] = {}
    for b in d.get("breakdown", []) or []:
        g = b.get("group")
        name = _NONE_KEY if (not g or g == "(none)") else _name_and_code(str(g))[0]
        costs[name] = round(costs.get(name, 0.0) + float(b.get("total_cost", 0) or 0), 2)
    return label, costs


def _pivot_by_month(
    windows: list[tuple], month_costs: dict[str, dict[str, float]], failed: set[str]
) -> tuple[list[str], list[dict[str, str | float]]]:
    """Pure pivot for the monthly-billing chart. Returns (series, by_month):
      • series = top-_MAX_COURIERS couriers by total cost, plus "Other" when any cost
        falls outside the top-N (the 9th+ couriers or the "(none)" bucket) — so Σ series
        == the month's full billing (no silent shortfall).
      • by_month rows follow the window order; a FAILED month is emitted as {"month": lbl}
        with no courier values (renders as a gap), never omitted."""
    totals: dict[str, float] = {}
    for costs in month_costs.values():
        for c, v in costs.items():
            totals[c] = totals.get(c, 0.0) + v
    ranked = [c for c in sorted(totals, key=lambda k: (-totals[k], k)) if c != _NONE_KEY]
    couriers = ranked[:_MAX_COURIERS]
    top = set(couriers)
    other_present = any(k not in top for k in totals)  # 9th+ courier or "(none)" present
    series = couriers + ([_OTHER_LABEL] if other_present else [])

    by_month: list[dict[str, str | float]] = []
    for label, *_rest in windows:
        if label in failed:
            by_month.append({"month": label})  # failed → gap, no courier values
            continue
        if label not in month_costs:
            continue
        costs = month_costs[label]
        row: dict[str, str | float] = {"month": label}
        for c in couriers:
            row[c] = round(costs.get(c, 0.0), 2)
        if other_present:
            row[_OTHER_LABEL] = round(sum(v for k, v in costs.items() if k not in top), 2)
        by_month.append(row)
    return series, by_month


async def _fetch_live(date_from: str | None, date_to: str | None) -> TrendResponse:
    args = live_support.date_args(date_from, date_to)
    windows = month_windows(date_from, date_to)
    sem = asyncio.Semaphore(4)
    # daily_booking_trend is independent of the monthly windows → run it in the SAME
    # concurrent wave as the per-month cost calls (was sequential: daily THEN monthly).
    daily_raw_r, *results = await asyncio.gather(
        mcp_client.call_tool("daily_booking_trend", args),
        *[_month_costs(lbl, ws, we, sem) for lbl, ws, we, _ in windows],
    )
    daily_raw = live_support.parse_tool_json(daily_raw_r)
    daily = [
        TrendDay(day=str(d.get("day", ""))[:10], orders=int(d.get("orders", 0) or 0),
                 order_value=round(float(d.get("order_value", 0) or 0), 2))
        for d in daily_raw.get("days", []) or []
    ]

    month_costs: dict[str, dict[str, float]] = {}
    failed: set[str] = set()
    for label, costs in results:
        if costs is None:
            failed.add(label)  # surfaced as a gap below, never silently dropped
        else:
            month_costs[label] = costs

    couriers, by_month = _pivot_by_month(windows, month_costs, failed)
    partial_months = [lbl for lbl, _ws, _we, partial in windows if partial and lbl in month_costs]
    failed_months = [lbl for lbl, _ws, _we, _p in windows if lbl in failed]
    window = (
        f"{windows[0][1]} → {windows[-1][2]} · {len(month_costs)} month(s)"
        if month_costs else "no complete month in range"
    )

    return TrendResponse(
        daily=daily, couriers=couriers, by_month=by_month,
        partial_months=partial_months, failed_months=failed_months,
        window=window, source="live", date_field="order_date",
    )


async def get_trend(date_from: str | None = None, date_to: str | None = None) -> TrendResponse:
    return await live_support.live_or_mock(
        cache=_cache, key=(date_from, date_to), label="trend",
        fetch=lambda: _fetch_live(date_from, date_to), mock=_load_mock,
    )
