"""COD reconciliation service — live via MCP with mock fallback.

Live sources (all driven by order_date):
  - order_analytics group_by=courier → per-courier orders + cod_value (the table
    and the "COD value by courier" chart) and totals.cod_value (a KPI).
  - cod_remittance_summary → global remitted + records + Pending/Settled counts.
  - Weekly series: 4 consecutive windows across the range, each = that window's
    order_analytics.cod_value (collected) + cod_remittance_summary.remitted.

Per-courier remitted/pending/TDS do NOT exist in the MCP, so they are not
surfaced. Remittance LAGS a few days (recent windows show collected high /
remitted ~0) — that's expected, surfaced as a note in the UI.
"""

import asyncio
import logging
from datetime import date, timedelta

from app.schemas.cod import CodCourier, CodResponse, CodWeekly
from app.schemas.dashboard import Kpi
from app.services import live_support, mcp_client
from app.services.courier_service import _name_and_code
from app.services.dashboard_service import _delta_kpi, _delta_windows
from app.utils.mock import load_mock

logger = logging.getLogger("live")
_cache = live_support.new_cache()


def _load_mock() -> CodResponse:
    return CodResponse(**load_mock("cod.json"))  # source defaults to "mock"


def _kpi(key: str, label: str, value: float, fmt: str) -> Kpi:
    # No trustworthy period-over-period delta from the MCP → neutral 0 (not faked).
    return Kpi(key=key, label=label, value=round(value, 2), format=fmt, delta=0.0, delta_tone="neutral")


def _four_windows(date_from: str | None, date_to: str | None) -> list[tuple[str, str]]:
    """Split [from, to] into 4 consecutive windows (default: last 28 days)."""
    try:
        end = date.fromisoformat(date_to) if date_to else date.today()
    except ValueError:
        end = date.today()
    try:
        start = date.fromisoformat(date_from) if date_from else end - timedelta(days=27)
    except ValueError:
        start = end - timedelta(days=27)
    if start > end:
        start, end = end, start
    total_days = (end - start).days + 1
    step = max(1, total_days // 4)
    windows: list[tuple[str, str]] = []
    cur = start
    for i in range(4):
        w_end = end if i == 3 else min(end, cur + timedelta(days=step - 1))
        windows.append((cur.isoformat(), w_end.isoformat()))
        cur = w_end + timedelta(days=1)
        if cur > end:
            # Range shorter than 4 days — pad remaining windows with the last day.
            windows += [(end.isoformat(), end.isoformat())] * (3 - i)
            break
    return windows[:4]


async def _oa_cod_value(date_from: str, date_to: str) -> float:
    raw = live_support.parse_tool_json(
        await mcp_client.call_tool("order_analytics", {"from": date_from, "to": date_to, "group_by": "courier"})
    )
    return float((raw.get("totals") or {}).get("cod_value", 0) or 0)


async def _remitted(date_from: str, date_to: str) -> float:
    raw = live_support.parse_tool_json(
        await mcp_client.call_tool("cod_remittance_summary", {"from": date_from, "to": date_to})
    )
    return float((raw.get("totals") or {}).get("remitted", 0) or 0)


async def _fetch_live(date_from: str | None, date_to: str | None) -> CodResponse:
    args = live_support.date_args(date_from, date_to)
    cur_args, prev_args = _delta_windows(date_from, date_to)

    # Current per-courier COD value + global remittance (selected window, values),
    # plus order_analytics for the complete current + previous windows — used ONLY for
    # the COD-value delta. COD value is order-placement (final once a day closes) → its
    # delta is trustworthy. Remittance (remitted / pending) LAGS days, so those get NO
    # delta: recent windows show artificially low remitted / shifting pending, which
    # would read as a swing that's really just un-posted reconciliation. Concurrent.
    oa_r, cod_r, doa_c, doa_p = await asyncio.gather(
        mcp_client.call_tool("order_analytics", {**args, "group_by": "courier"}),
        mcp_client.call_tool("cod_remittance_summary", args),
        mcp_client.call_tool("order_analytics", {**cur_args, "group_by": "courier"}),
        mcp_client.call_tool("order_analytics", {**prev_args, "group_by": "courier"}),
        return_exceptions=True,
    )
    for r in (oa_r, cod_r):  # current required → mock fallback on failure
        if isinstance(r, Exception):
            raise r
    oa = live_support.parse_tool_json(oa_r)
    cod = live_support.parse_tool_json(cod_r)

    def _pv(r):
        return None if isinstance(r, Exception) else live_support.parse_tool_json(r)

    def _codv(d: dict | None) -> float | None:
        return float((d.get("totals") or {}).get("cod_value", 0) or 0) if d else None

    poa_c, poa_p = _pv(doa_c), _pv(doa_p)
    delta_ok = poa_c is not None and poa_p is not None

    oa_totals = oa.get("totals") or {}
    cod_totals = cod.get("totals") or {}
    bs = {s.get("status"): s for s in cod.get("by_status", []) or []}
    pending_records = float((bs.get("Pending") or {}).get("records", 0) or 0)

    kpis = [
        # Volume metric → NEUTRAL tone (gray directional %), not a cost/efficiency signal.
        _delta_kpi("cod_value", "COD Value", float(oa_totals.get("cod_value", 0) or 0),
                   _codv(poa_c) if delta_ok else None, _codv(poa_p) if delta_ok else None, "currency", None),
        _kpi("remitted", "COD Remitted", float(cod_totals.get("remitted", 0) or 0), "currency"),
        _kpi("cod_records", "COD Records", float(cod_totals.get("records", 0) or 0), "number"),
        _kpi("pending", "Pending Records", pending_records, "number"),
    ]

    reconciliation = [
        CodCourier(
            courier=_name_and_code(str(g.get("group", "")))[0],
            orders=int(g.get("orders", 0) or 0),
            cod_value=round(float(g.get("cod_value", 0) or 0), 2),
        )
        for g in oa.get("breakdown", []) or []
    ]
    reconciliation.sort(key=lambda c: c.cod_value, reverse=True)

    # Weekly: 4 windows, each = order_analytics.cod_value + cod_remittance.remitted.
    windows = _four_windows(date_from, date_to)
    week_vals = await asyncio.gather(
        *[_oa_cod_value(ws, we) for ws, we in windows],
        *[_remitted(ws, we) for ws, we in windows],
    )
    collected_vals, remitted_vals = week_vals[:4], week_vals[4:]
    weekly = [
        CodWeekly(week=f"Week {i + 1}", collected=round(collected_vals[i], 2), remitted=round(remitted_vals[i], 2))
        for i in range(4)
    ]

    return CodResponse(kpis=kpis, reconciliation=reconciliation, weekly=weekly, source="live", date_field="order_date")


async def get_cod(date_from: str | None = None, date_to: str | None = None) -> CodResponse:
    return await live_support.live_or_mock(
        cache=_cache, key=(date_from, date_to), label="cod",
        fetch=lambda: _fetch_live(date_from, date_to), mock=_load_mock,
    )
