"""Dashboard service — live via MCP with mock fallback.

Everything is live from real tools:
  KPIs           order_analytics.totals + shipping_cost_summary.totals +
                 cod_remittance_summary + weight_reconciliation_summary.fwd_rate_diff
                 + sla_performance (on-time% / overdue — GLOBAL, never per courier).
  courier bar    shipping_cost_summary group_by=courier → Forward + RTO ONLY.
  distribution   order_analytics group_by=courier → orders.
  state cost     shipping_cost_summary group_by=state (canonicalized).
No fictional cod/fuel segments, no zone panel.
"""

import asyncio
import logging
from datetime import date, timedelta

from app.schemas.dashboard import (
    CourierBillingResponse,
    CourierBillingRow,
    DashboardResponse,
    DistributionSlice,
    Kpi,
    RateDiffKpi,
    StateCostRow,
)
from app.services import live_support, mcp_client
from app.services.courier_service import _name_and_code
from app.services.order_sampling import sample_orders
from app.services.zone_service import _canon_state
from app.utils.mock import load_mock

logger = logging.getLogger("live")
_cache = live_support.new_cache()
_rate_cache = live_support.new_cache()
_billing_cache = live_support.new_cache()


def _delta_windows(date_from: str | None, date_to: str | None) -> tuple[dict, dict]:
    """(current, previous) COMPLETE equal-length windows for period-over-period deltas.

    The selected window usually ends TODAY, which is a partial (half-finished) day —
    comparing a partial current window against a complete previous one biases every
    total downward (the current side is under-counted). So for the DELTA we anchor the
    current window's end at the last COMPLETE day (yesterday) and take the equal-length
    block before it. If the selected window is fully historical (ends before today),
    it's already complete and used as-is. The displayed VALUE still uses the selected
    window; only the delta comparison uses these."""
    today = date.today()
    try:
        to = date.fromisoformat(date_to) if date_to else today
    except ValueError:
        to = today
    try:
        frm = date.fromisoformat(date_from) if date_from else to - timedelta(days=29)
    except ValueError:
        frm = to - timedelta(days=29)
    if frm > to:
        frm, to = to, frm
    span = (to - frm).days + 1
    c_to = min(to, today - timedelta(days=1))  # last COMPLETE day (exclude partial today)
    c_frm = c_to - timedelta(days=span - 1)
    p_to = c_frm - timedelta(days=1)
    p_frm = p_to - timedelta(days=span - 1)
    return ({"from": c_frm.isoformat(), "to": c_to.isoformat()},
            {"from": p_frm.isoformat(), "to": p_to.isoformat()})


def _delta_kpi(key: str, label: str, value: float, cur: float | None, prev: float | None,
               fmt: str, higher_is_good: bool | None, subtitle: str | None = None,
               unavailable: bool = False) -> Kpi:
    """KPI with a real % delta. `value` is the number shown (selected window);
    `(cur, prev)` are the COMPLETE-period scalars the delta is computed from — so the
    displayed value can include today while the delta stays unbiased. `higher_is_good`
    None → show the % but with a NEUTRAL tone (movement without a good/bad judgement),
    for volume metrics where a direction isn't inherently better or worse. cur/prev
    None or prev==0 → no delta shown (never fabricated)."""
    if unavailable or cur is None or prev is None or prev == 0:
        return Kpi(key=key, label=label, value=round(value, 2), format=fmt,
                   delta=0.0, delta_tone="neutral", has_delta=False, subtitle=subtitle,
                   unavailable=unavailable)
    d = round((cur - prev) / prev * 100, 1)
    if higher_is_good is None:
        tone = "neutral"
    else:
        tone = "neutral" if d == 0 else ("positive" if (d > 0) == higher_is_good else "negative")
    return Kpi(key=key, label=label, value=round(value, 2), format=fmt,
               delta=d, delta_tone=tone, has_delta=True, subtitle=subtitle)


def _load_mock() -> DashboardResponse:
    return DashboardResponse(**load_mock("dashboard.json"))


_RATE_LABEL = "Pending Reconciliation"
_RATE_SUB = "disputed invoiced − applied · pending reconciliation · lags"


def _rate_diff_mock() -> RateDiffKpi:
    # date_field = reconciliation_at: this KPI's window filters on the reconciliation
    # date (not order_date), so the UI can label its basis correctly.
    return RateDiffKpi(
        kpi=_kpi("rate_diff", _RATE_LABEL, 2749841.0, "currency", _RATE_SUB),
        source="mock", date_field="reconciliation_at",
    )


async def _rate_diff_live(date_from: str | None, date_to: str | None) -> RateDiffKpi:
    args = live_support.date_args(date_from, date_to)
    # Pending Reconciliation = the rate difference on rows still DISPUTED (not yet
    # reconciled), from reconciliation_summary grouped by status.
    r = live_support.parse_tool_json(
        await mcp_client.call_tool("reconciliation_summary", {**args, "group_by": "status"})
    )
    disputed = next((b for b in r.get("breakdown", []) or [] if b.get("group") == "Disputed"), None)
    amt = float((disputed or r.get("totals") or {}).get("rate_diff", 0) or 0)
    # No delta: reconciliation posts days late (by reconciliation_at), so a
    # period-over-period delta would be a maturation artifact. Show the live value.
    return RateDiffKpi(
        kpi=_kpi("rate_diff", _RATE_LABEL, amt, "currency", _RATE_SUB),
        source="live", date_field="reconciliation_at",
    )


async def get_rate_diff(date_from: str | None = None, date_to: str | None = None) -> RateDiffKpi:
    """Slow 'Pending Reconciliation' KPI (reconciliation_summary) — own 60s cache,
    fetched separately so it never delays the main dashboard."""
    return await live_support.live_or_mock(
        cache=_rate_cache, key=(date_from, date_to), label="dashboard-rate-diff",
        fetch=lambda: _rate_diff_live(date_from, date_to), mock=_rate_diff_mock,
    )


def _kpi(key: str, label: str, value: float, fmt: str, subtitle: str | None = None,
         unavailable: bool = False) -> Kpi:
    return Kpi(key=key, label=label, value=round(value, 2), format=fmt, delta=0.0,
               delta_tone="neutral", subtitle=subtitle, unavailable=unavailable)


def _totals(oa: dict, state: dict, cod: dict, sla: dict) -> dict:
    """Pull the KPI scalars out of the 4 tool payloads (None-safe for prev window)."""
    oa_t = (oa or {}).get("totals", {}) or {}
    cost_t = (state or {}).get("totals", {}) or {}
    by_status = {s.get("status"): s for s in (cod or {}).get("by_status", []) or []}
    orders = float(oa_t.get("orders", 0) or 0)
    total_cost = float(cost_t.get("total_cost", 0) or 0)
    return {
        "orders": orders,
        "total_cost": total_cost,
        "avg_cost": total_cost / orders if orders else 0.0,
        "cod_value": float(oa_t.get("cod_value", 0) or 0),
        "pending": float((by_status.get("Pending") or {}).get("records", 0) or 0),
        "on_time_pct": float((sla or {}).get("on_time_pct", 0) or 0),
        "overdue": float((sla or {}).get("overdue_in_transit", 0) or 0),
    }


async def _fetch_live(date_from: str | None, date_to: str | None) -> DashboardResponse:
    val_args = live_support.date_args(date_from, date_to)  # selected window → displayed VALUES
    cur_args, prev_args = _delta_windows(date_from, date_to)  # complete periods → DELTAS
    # weight_reconciliation_summary is served separately (get_rate_diff); the courier
    # billing bar is a separate sampled endpoint. Here: 4 tools for the selected window
    # (values, required) + order_analytics & shipping_cost_summary for the complete
    # current + previous windows (delta basis, best-effort). All 8 run concurrently.
    #
    # Deltas are ONLY computed for order-placement metrics (orders / cost / COD value),
    # which are final the moment a day closes. Delivery- and remittance-lagged metrics
    # (on-time %, overdue, pending reconciliation) get NO delta: their current-window
    # figure is still maturing (verified: current window ~54% delivered vs ~88% a month
    # back; remittance posts days later), so a period delta would be an artifact.
    val_tools = [("order_analytics", {"group_by": "courier"}),
                 ("shipping_cost_summary", {"group_by": "state"}),
                 ("cod_remittance_aging", {})]
    val_calls = [mcp_client.call_tool(t, {**val_args, **e}) for t, e in val_tools]
    delta_calls = [
        mcp_client.call_tool("order_analytics", {**cur_args, "group_by": "courier"}),
        mcp_client.call_tool("shipping_cost_summary", {**cur_args, "group_by": "state"}),
        mcp_client.call_tool("order_analytics", {**prev_args, "group_by": "courier"}),
        mcp_client.call_tool("shipping_cost_summary", {**prev_args, "group_by": "state"}),
    ]
    results = await asyncio.gather(*val_calls, *delta_calls, return_exceptions=True)

    val_r, delta_r = results[:3], results[3:]
    for r in val_r:  # selected-window values are required → fail to mock fallback
        if isinstance(r, Exception):
            raise r
    oa, state, aging = (live_support.parse_tool_json(r) for r in val_r)
    # COD Remittance = live per-window remitted from cod_remittance_aging.
    remitted = float((aging.get("totals") or {}).get("remitted", 0) or 0)

    def _pj(r):
        return None if isinstance(r, Exception) else live_support.parse_tool_json(r)

    doa_c, dcost_c, doa_p, dcost_p = (_pj(r) for r in delta_r)
    delta_ok = all(x is not None for x in (doa_c, dcost_c, doa_p, dcost_p))
    cur = _totals(oa, state, {}, {})  # displayed values (selected window)
    dc = _totals(doa_c, dcost_c, {}, {}) if delta_ok else None  # complete current
    dp = _totals(doa_p, dcost_p, {}, {}) if delta_ok else None  # complete previous

    def dcur(k: str) -> float | None:
        return dc[k] if dc else None

    def dprev(k: str) -> float | None:
        return dp[k] if dp else None

    # The selected window returned no orders at all (e.g. "Today" before the day's
    # data lands). Every value below is a real 0 for an EMPTY range → show "N/A" so
    # it doesn't read as a genuine ₹0. Never fabricates a value.
    window_empty = cur["orders"] == 0 and not (oa.get("breakdown") or [])
    kpis = [
        # Total Billed Amount = shipping_cost_summary forward + RTO (= total_cost).
        _delta_kpi("total_billing", "Total Billed Amount", cur["total_cost"], dcur("total_cost"), dprev("total_cost"), "currency", False, "forward + RTO cost", unavailable=window_empty),
        # Volume — real delta, NEUTRAL tone (more/fewer orders isn't good/bad).
        _delta_kpi("total_shipments", "Total Shipments", cur["orders"], dcur("orders"), dprev("orders"), "number", None, unavailable=window_empty),
        # Avg Cost/Shipment = Total Billed ÷ Total Shipments.
        _delta_kpi("average_cost", "Avg Cost/Shipment", cur["avg_cost"], dcur("avg_cost"), dprev("avg_cost"), "currency", False, unavailable=window_empty),
        # COD Remittance = live remitted (cod_remittance_aging); remittance lags → no delta.
        _kpi("total_cod", "COD Remittance", remitted, "currency", "actual COD remitted (cod_remittance_aging) · lags a few days", unavailable=window_empty),
    ]

    # Distribution — orders per courier.
    distribution = [
        DistributionSlice(name=_name_and_code(str(b.get("group")))[0], value=int(b.get("orders", 0) or 0))
        for b in oa.get("breakdown", []) or []
        if b.get("group") and b.get("group") != "(none)"
    ]

    # State cost (canonicalized, top 8).
    state_agg: dict[str, float] = {}
    for b in state.get("breakdown", []) or []:
        key = _canon_state(b.get("group")) or "Unknown"
        state_agg[key] = state_agg.get(key, 0) + float(b.get("total_cost", 0) or 0)
    state_cost = [
        StateCostRow(state=s, total_cost=round(c, 2))
        for s, c in sorted(state_agg.items(), key=lambda kv: kv[1], reverse=True)[:10]
    ]

    return DashboardResponse(
        kpis=kpis, distribution=distribution,
        state_cost=state_cost, source="live", date_field="order_date",
    )


async def get_dashboard(date_from: str | None = None, date_to: str | None = None) -> DashboardResponse:
    return await live_support.live_or_mock(
        cache=_cache, key=(date_from, date_to), label="dashboard",
        fetch=lambda: _fetch_live(date_from, date_to), mock=_load_mock,
    )


# --- Courier billing bar (sampled component breakdown) — separate endpoint ------
def _billing_mock() -> CourierBillingResponse:
    return CourierBillingResponse(**load_mock("courier_billing.json"))


async def _billing_live(date_from: str | None, date_to: str | None) -> CourierBillingResponse:
    """Per-courier FORWARD cost breakdown (Base Freight / GST / COD Charges) from a
    stride sample of list_orders' rate_summary (fuel/other are always 0 → omitted),
    PLUS the real population RTO cost from shipping_cost_summary (kept separate —
    rate_summary.rto is a quoted rate on ~99% of orders, not actual returns)."""
    args = live_support.date_args(date_from, date_to)
    (all_orders, total, is_full), cost_r = await asyncio.gather(
        sample_orders(args),
        mcp_client.call_tool("shipping_cost_summary", {**args, "group_by": "courier"}),
    )
    cost = live_support.parse_tool_json(cost_r)

    # Real per-courier RTO cost (population, from shipping_cost_summary).
    rto_actual = {
        _name_and_code(str(b.get("group")))[0]: round(float(b.get("rto_cost", 0) or 0), 2)
        for b in cost.get("breakdown", []) or []
        if b.get("group") and b.get("group") != "(none)"
    }

    agg: dict[str, dict[str, float]] = {}
    n = 0
    for o in all_orders:
        fwd = ((o.get("rate_summary") or {}).get("base_rates") or {}).get("forward") or {}
        if not fwd:
            continue
        n += 1
        courier = _name_and_code(str(o.get("courier_slug", "")))[0]
        d = agg.setdefault(courier, {"base_freight": 0.0, "gst": 0.0, "cod_charges": 0.0})
        d["base_freight"] += float(fwd.get("base_freight", 0) or 0)
        d["gst"] += float(fwd.get("gst", 0) or 0)
        d["cod_charges"] += float(fwd.get("cod_charges", 0) or 0)

    rows = [
        CourierBillingRow(
            courier=c, base_freight=round(d["base_freight"], 2), gst=round(d["gst"], 2),
            cod_charges=round(d["cod_charges"], 2),
            total=round(d["base_freight"] + d["gst"] + d["cod_charges"], 2),
            rto_actual=rto_actual.get(c, 0.0),
        )
        for c, d in agg.items()
    ]
    rows.sort(key=lambda r: r.total, reverse=True)
    return CourierBillingResponse(
        rows=rows, sample_size=n, total_matched=total, is_full=is_full, source="live",
    )


async def get_courier_billing(
    date_from: str | None = None, date_to: str | None = None
) -> CourierBillingResponse:
    return await live_support.live_or_mock(
        cache=_billing_cache, key=(date_from, date_to), label="dashboard-courier-billing",
        fetch=lambda: _billing_live(date_from, date_to), mock=_billing_mock,
    )
