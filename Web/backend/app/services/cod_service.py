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

from app.schemas.cod import (
    CodCourier,
    CodDimensionRow,
    CodIntelligenceResponse,
    CodPaymentEconomics,
    CodPaymentSplit,
    CodPendingCourier,
    CodPendingResponse,
    CodResponse,
    CodUnavailableMetric,
    CodWeekly,
)
from app.schemas.dashboard import Kpi
from app.services import live_support, mcp_client
from app.services.courier_service import _name_and_code, _norm
from app.services.dashboard_service import _delta_kpi, _delta_windows
from app.utils.mock import load_mock

logger = logging.getLogger("live")
_cache = live_support.new_cache()
_pending_cache = live_support.new_cache()
_intel_cache = live_support.new_cache()

# COD-intelligence metrics that CANNOT be produced from the available MCP tools.
# Surfaced verbatim as "Not available from MCP" — the exact missing capability is
# stated so it's never mistaken for a value we chose not to show. (Verified live:
# rto_analysis has no payment dimension; repeat_customer_analysis has no
# payment_type filter; no COD tool exposes a TDS/deduction field.)
_COD_UNAVAILABLE: list[tuple[str, str]] = [
    ("COD RTO %",
     "The authoritative RTO source (rto_analysis / geo_performance) exposes no "
     "payment_type dimension. The only payment-split RTO available — list_orders "
     "filtered payment_type=COD & status=RTO — counts only orders CURRENTLY in RTO "
     "status, a small fraction of the authoritative RTO population (it excludes "
     "already-returned / closed RTO). It cannot represent the true COD RTO rate "
     "without assuming the full RTO status taxonomy."),
    ("Prepaid RTO %",
     "Same limitation as COD RTO %: rto_analysis has no payment dimension, and "
     "list_orders status=RTO captures only the point-in-time RTO-status subset, which "
     "does not reconcile with the authoritative RTO count."),
    ("Pincode COD vs Prepaid",
     "No tool provides a COD / payment split at pincode granularity — order_analytics "
     "has no 'pincode' group_by (allowed: status/courier/payment_type/warehouse/state/"
     "channel/seller/dropshipper/shipping_method/shipping_company/seller_account/user), "
     "and geo_performance(group_by=pincode) exposes only delivery / RTO performance "
     "with no payment_type or COD field."),
    ("COD Repeat-Customer Rate",
     "repeat_customer_analysis accepts no payment_type filter, so COD-only customers "
     "cannot be isolated from prepaid ones."),
    ("Per-courier TDS / Deductions",
     "No COD tool (cod_remittance_summary / cod_remittance_aging) exposes a TDS or "
     "deduction field; only records / remitted / outstanding / overdue / shortfall / "
     "avg_tat_days are available."),
]


def _unavailable_metrics() -> list[CodUnavailableMetric]:
    return [CodUnavailableMetric(metric=m, reason=r) for m, r in _COD_UNAVAILABLE]


# Honesty label appended to settlement metrics: recent windows read low because
# remittance lags order placement (presentation only — no calculation changes).
_SETTLEMENT_MATURITY = (
    "Recent orders may not have completed settlement cycles; settlement metrics mature over time."
)


def _load_mock() -> CodResponse:
    # Honest "unavailable" (empty) by default — fixtures only in dev (USE_MOCK_FALLBACK).
    if live_support.settings.use_mock_fallback:
        return CodResponse(**load_mock("cod.json"))
    return CodResponse(kpis=[], reconciliation=[], weekly=[], source="unavailable")


def _kpi(key: str, label: str, value: float, fmt: str, subtitle: str | None = None) -> Kpi:
    # No trustworthy period-over-period delta from the MCP → neutral 0 (not faked).
    return Kpi(key=key, label=label, value=round(value, 2), format=fmt, delta=0.0, delta_tone="neutral", subtitle=subtitle)


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
    # The weekly-chart windows depend only on the date args (not on the KPI results),
    # so fire the KPI/delta calls AND the 8 weekly calls in ONE concurrent wave
    # instead of two sequential gather waves (was: main gather → then weekly gather).
    windows = _four_windows(date_from, date_to)
    results = await asyncio.gather(
        mcp_client.call_tool("order_analytics", {**args, "group_by": "courier"}),
        mcp_client.call_tool("cod_remittance_summary", args),
        mcp_client.call_tool("order_analytics", {**cur_args, "group_by": "courier"}),
        mcp_client.call_tool("order_analytics", {**prev_args, "group_by": "courier"}),
        *[_oa_cod_value(ws, we) for ws, we in windows],
        *[_remitted(ws, we) for ws, we in windows],
        return_exceptions=True,
    )
    oa_r, cod_r, doa_c, doa_p = results[:4]
    weekly_results = results[4:]
    for r in (oa_r, cod_r):  # current required → mock fallback on failure
        if isinstance(r, Exception):
            raise r
    for r in weekly_results:  # weekly required too (matches prior no-return_exceptions gather)
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
        _kpi("remitted", "COD Remitted", float(cod_totals.get("remitted", 0) or 0), "currency",
             subtitle=_SETTLEMENT_MATURITY),
        _kpi("cod_records", "COD Records", float(cod_totals.get("records", 0) or 0), "number"),
        _kpi("pending", "Pending Reconciliation Items", pending_records, "number",
             subtitle="May include reconciliation cycle delays; not confirmed receivables."),
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

    # Weekly (collected/remitted) — computed in the single concurrent wave above.
    collected_vals, remitted_vals = weekly_results[:4], weekly_results[4:]
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


# --- COD Pending by courier (additive) — per-courier aging from cod_remittance_aging,
#     joined with order_analytics for the COD amount. Existing get_cod is untouched. ---
def _cod_status(row: dict) -> str:
    """Worst-first status from cod_remittance_aging record counts."""
    if int(row.get("mismatched_records", 0) or 0) > 0:
        return "Mismatched"
    if int(row.get("overdue_records", 0) or 0) > 0:
        return "Overdue"
    if int(row.get("pending_records", 0) or 0) > 0:
        return "Pending"
    return "Settled"


def _cod_pending_mock() -> CodPendingResponse:
    return CodPendingResponse(source="unavailable")  # empty — never fabricate couriers/amounts


async def _cod_pending_live(date_from: str | None, date_to: str | None) -> CodPendingResponse:
    args = live_support.date_args(date_from, date_to)
    aging_r, oa_r = await asyncio.gather(
        mcp_client.call_tool("cod_remittance_aging", {**args, "group_by": "courier"}),
        mcp_client.call_tool("order_analytics", {**args, "group_by": "courier"}),
    )
    aging = live_support.parse_tool_json(aging_r)
    oa = live_support.parse_tool_json(oa_r)
    # COD amount per courier (order_analytics groups by slug → display; join on normalized name).
    cod_by_norm = {
        _norm(_name_and_code(str(b.get("group", "")))[0]): float(b.get("cod_value", 0) or 0)
        for b in oa.get("breakdown", []) or []
        if b.get("group") and b.get("group") != "(none)"
    }
    rows = [
        CodPendingCourier(
            courier=str(b.get("group", "")),
            cod_shipments=int(b.get("records", 0) or 0),
            cod_amount=cod_by_norm.get(_norm(str(b.get("group", "")))),  # None → "N/A"
            remitted=round(float(b.get("remitted", 0) or 0), 2),
            pending=round(float(b.get("outstanding", 0) or 0), 2),
            status=_cod_status(b),
        )
        for b in aging.get("breakdown", []) or []
        if b.get("group") and b.get("group") != "(none)"
    ]
    rows.sort(key=lambda r: r.pending, reverse=True)
    return CodPendingResponse(rows=rows, source="live", date_field="order_date")


async def get_cod_pending(date_from: str | None = None, date_to: str | None = None) -> CodPendingResponse:
    return await live_support.live_or_mock(
        cache=_pending_cache, key=(date_from, date_to), label="cod-pending",
        fetch=lambda: _cod_pending_live(date_from, date_to), mock=_cod_pending_mock,
    )


# --- COD Intelligence (additive) -----------------------------------------------
# Extends the COD page with intelligence KPIs. EVERY KPI is a live MCP field or a
# ratio of two live fields from ONE tool (never cross-tool, never fabricated):
#   order_analytics(group_by=payment_type) → COD share, avg COD order value, split
#   cod_remittance_aging (totals)          → remittance/overdue rate, outstanding,
#                                            overdue amount
#   cod_remittance_aging(group_by=status)  → Settled.avg_tat_days (settlement TAT)
# Metrics the MCP can't produce are returned in `unavailable` (see _COD_UNAVAILABLE)
# so the UI shows "Not available from MCP" instead of a guessed number.
def _cod_intel_mock() -> CodIntelligenceResponse:
    # Honest "unavailable" — no KPIs. The unavailable-capability list is static
    # explanatory text (not window data), so it's still returned.
    return CodIntelligenceResponse(
        kpis=[], payment_split=[], unit_economics=[], warehouse_cod=[], seller_cod=[],
        unavailable=_unavailable_metrics(), source="unavailable", date_field="order_date",
    )


def _dimension_rows(payload: dict, top: int = 8) -> list[CodDimensionRow]:
    """Top-N (by cod_value) warehouse/seller rows from order_analytics(group_by=…).
    COD intensity is the row's OWN cod_value / order_value (single row, single tool —
    never blended). Blank groups are skipped."""
    rows: list[CodDimensionRow] = []
    for b in payload.get("breakdown", []) or []:
        group = str(b.get("group", "") or "")
        if not group:
            continue
        order_value = float(b.get("order_value", 0) or 0)
        cod_value = float(b.get("cod_value", 0) or 0)
        rows.append(CodDimensionRow(
            group=group, orders=int(b.get("orders", 0) or 0),
            order_value=round(order_value, 2), cod_value=round(cod_value, 2),
            cod_intensity_pct=round(cod_value / order_value * 100, 2) if order_value else 0.0,
        ))
    rows.sort(key=lambda r: r.cod_value, reverse=True)
    return rows[:top]


async def _cod_intel_live(date_from: str | None, date_to: str | None) -> CodIntelligenceResponse:
    args = live_support.date_args(date_from, date_to)
    pay_r, aging_r, aging_status_r, cost_pay_r, wh_r, seller_r = await asyncio.gather(
        mcp_client.call_tool("order_analytics", {**args, "group_by": "payment_type"}),
        mcp_client.call_tool("cod_remittance_aging", {**args, "group_by": "courier"}),
        mcp_client.call_tool("cod_remittance_aging", {**args, "group_by": "status"}),
        mcp_client.call_tool("shipping_cost_summary", {**args, "group_by": "payment_type"}),
        mcp_client.call_tool("order_analytics", {**args, "group_by": "warehouse"}),
        mcp_client.call_tool("order_analytics", {**args, "group_by": "seller"}),
    )
    pay = live_support.parse_tool_json(pay_r)
    aging = live_support.parse_tool_json(aging_r)
    aging_status = live_support.parse_tool_json(aging_status_r)
    cost_pay = live_support.parse_tool_json(cost_pay_r)

    # order_analytics(payment_type): COD share + avg COD order value (ratios stay
    # WITHIN this one tool so they're internally consistent).
    pay_totals = pay.get("totals") or {}
    pay_rows = {str(b.get("group")): b for b in pay.get("breakdown", []) or []}
    cod_row = pay_rows.get("COD", {})
    total_orders = float(pay_totals.get("orders", 0) or 0)
    cod_orders = float(cod_row.get("orders", 0) or 0)
    cod_order_value = float(cod_row.get("order_value", 0) or 0)
    cod_share = round(cod_orders / total_orders * 100, 2) if total_orders else 0.0
    avg_cod_value = round(cod_order_value / cod_orders, 2) if cod_orders else 0.0

    # cod_remittance_aging totals: remittance/overdue rates + outstanding/overdue ₹.
    aging_t = aging.get("totals") or {}
    records = float(aging_t.get("records", 0) or 0)
    settled = float(aging_t.get("settled_records", 0) or 0)
    overdue_records = float(aging_t.get("overdue_records", 0) or 0)
    outstanding = float(aging_t.get("outstanding", 0) or 0)
    overdue_amount = float(aging_t.get("overdue_amount", 0) or 0)
    remittance_rate = round(settled / records * 100, 2) if records else 0.0
    overdue_rate = round(overdue_records / records * 100, 2) if records else 0.0

    # Settlement TAT = the Settled status group's avg_tat_days (a direct live field).
    settled_status = next(
        (b for b in aging_status.get("breakdown", []) or [] if b.get("group") == "Settled"), {}
    )
    settlement_tat = round(float(settled_status.get("avg_tat_days", 0) or 0), 2)

    kpis = [
        _kpi("cod_share", "COD Order Share", cod_share, "percent",
             "COD orders / all orders · order_analytics(payment_type)"),
        _kpi("avg_cod_value", "Avg COD Order Value", avg_cod_value, "currency",
             "COD order value / COD orders · order_analytics(payment_type)"),
        _kpi("remittance_rate", "COD Remittance Rate", remittance_rate, "percent",
             f"settled / total COD records · cod_remittance_aging · {_SETTLEMENT_MATURITY}"),
        _kpi("overdue_rate", "COD Overdue Rate", overdue_rate, "percent",
             f"overdue / total COD records · cod_remittance_aging · {_SETTLEMENT_MATURITY}"),
        _kpi("overdue_amount", "Overdue COD Amount", round(overdue_amount, 2), "currency",
             "cod_remittance_aging.overdue_amount · settlement-record basis, not confirmed cash"),
        _kpi("outstanding_cod", "Unresolved COD Records", round(outstanding, 2), "currency",
             "Settlement-record balance, not confirmed receivable."),
        _kpi("settlement_tat", "Avg Settlement TAT (Days)", settlement_tat, "number",
             f"cod_remittance_aging(status=Settled).avg_tat_days · {_SETTLEMENT_MATURITY}"),
    ]

    payment_split = [
        CodPaymentSplit(
            payment_type=str(b.get("group", "")),
            orders=int(b.get("orders", 0) or 0),
            order_value=round(float(b.get("order_value", 0) or 0), 2),
        )
        for b in pay.get("breakdown", []) or []
        if b.get("group")
    ]

    # Unit economics per payment type: cost fields from shipping_cost_summary
    # (payment_type), avg order value from order_analytics(payment_type) for the SAME
    # payment type. Both tools agree on the per-payment order count (verified), so this
    # is COD-only / Prepaid-only — never blended.
    cost_by_pay = {str(b.get("group", "")): b for b in cost_pay.get("breakdown", []) or []}
    unit_economics = []
    for pt in ("COD", "Prepaid"):
        o = pay_rows.get(pt)
        c = cost_by_pay.get(pt)
        if not o and not c:
            continue
        o = o or {}
        c = c or {}
        orders = int(o.get("orders", 0) or 0)
        order_value = float(o.get("order_value", 0) or 0)
        unit_economics.append(CodPaymentEconomics(
            payment_type=pt, orders=orders,
            avg_order_value=round(order_value / orders, 2) if orders else 0.0,
            avg_shipping_cost=round(float(c.get("avg_cost", 0) or 0), 2),
            fwd_cost=round(float(c.get("fwd_cost", 0) or 0), 2),
            rto_cost=round(float(c.get("rto_cost", 0) or 0), 2),
            total_cost=round(float(c.get("total_cost", 0) or 0), 2),
        ))

    warehouse_cod = _dimension_rows(live_support.parse_tool_json(wh_r))
    seller_cod = _dimension_rows(live_support.parse_tool_json(seller_r))

    return CodIntelligenceResponse(
        kpis=kpis, payment_split=payment_split, unit_economics=unit_economics,
        warehouse_cod=warehouse_cod, seller_cod=seller_cod,
        unavailable=_unavailable_metrics(), source="live", date_field="order_date",
    )


async def get_cod_intelligence(
    date_from: str | None = None, date_to: str | None = None
) -> CodIntelligenceResponse:
    """COD Intelligence KPIs (order_analytics payment_type + cod_remittance_aging).
    Own 60s cache; live or honest 'unavailable' (never fabricated)."""
    return await live_support.live_or_mock(
        cache=_intel_cache, key=(date_from, date_to), label="cod-intelligence",
        fetch=lambda: _cod_intel_live(date_from, date_to), mock=_cod_intel_mock,
    )
