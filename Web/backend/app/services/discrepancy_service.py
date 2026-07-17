"""Discrepancies service — live via MCP with mock fallback.

  rate_diff: weight_reconciliation_summary (aggregate reconciliation lines).
  rto:  rto_analysis.by_courier.count ÷ order_analytics(courier).orders.
  ndr:  ndr_analysis.by_courier.count ÷ order_analytics(courier).orders.
Couriers with no RTO/NDR render 0.0% (kept, not dropped). Per-AWB weight cases /
overcharging ₹ do not exist and are not faked. Savings is a separate endpoint.
"""

import asyncio

from app.schemas.discrepancies import CourierRate, DiscrepancyResponse, RateDiff
from app.services import live_support, mcp_client
from app.services.courier_service import _name_and_code
from app.utils.mock import load_mock

_cache = live_support.new_cache()


def _load_mock() -> DiscrepancyResponse:
    return DiscrepancyResponse(**load_mock("discrepancies.json"))


def _per_courier(orders_by_slug: dict[str, int], counts_by_slug: dict[str, int]) -> list[CourierRate]:
    """Rate per courier over ALL couriers with orders (0.0% when count is 0)."""
    rows = [
        CourierRate(
            courier=_name_and_code(slug)[0],
            orders=orders,
            count=counts_by_slug.get(slug, 0),
            rate_pct=round(counts_by_slug.get(slug, 0) / orders * 100, 2) if orders else 0.0,
        )
        for slug, orders in orders_by_slug.items()
    ]
    rows.sort(key=lambda r: r.rate_pct, reverse=True)
    return rows


async def _fetch_live(date_from: str | None, date_to: str | None) -> DiscrepancyResponse:
    args = live_support.date_args(date_from, date_to)
    wr_r, rto_r, oa_r, ndr_r = await asyncio.gather(
        mcp_client.call_tool("weight_reconciliation_summary", args),
        mcp_client.call_tool("rto_analysis", args),
        mcp_client.call_tool("order_analytics", {**args, "group_by": "courier"}),
        mcp_client.call_tool("ndr_analysis", args),
    )
    wr = live_support.parse_tool_json(wr_r)
    rto = live_support.parse_tool_json(rto_r)
    oa = live_support.parse_tool_json(oa_r)
    ndr = live_support.parse_tool_json(ndr_r)

    rows = int(wr.get("rows", 0) or 0)
    by_status = wr.get("by_status", {}) or {}
    rate_diff = RateDiff(
        reconciliation_lines=rows,
        weight_overcharged=int(wr.get("weight_overcharged", 0) or 0),
        weight_diff_kg=round(float(wr.get("weight_diff_kg", 0) or 0), 2),
        fwd_rate_diff=round(float(wr.get("fwd_rate_diff", 0) or 0), 2),
        reconciled=int(by_status.get("Reconciled", 0) or 0),
        disputed=int(by_status.get("Disputed", 0) or 0),
        has_recon=rows > 0,
    )

    orders_by_slug = {
        str(g.get("group")): int(g.get("orders", 0) or 0)
        for g in oa.get("breakdown", []) or []
        if g.get("group") and g.get("group") != "(none)"
    }
    rto_by_slug = {str(c.get("value")): int(c.get("count", 0) or 0) for c in rto.get("by_courier", []) or []}
    ndr_by_slug = {str(c.get("value")): int(c.get("count", 0) or 0) for c in ndr.get("by_courier", []) or []}

    return DiscrepancyResponse(
        rate_diff=rate_diff,
        rto=_per_courier(orders_by_slug, rto_by_slug),
        ndr=_per_courier(orders_by_slug, ndr_by_slug),
        ndr_orders=int(ndr.get("ndr_orders", 0) or 0),
        ndr_avg_attempts=round(float(ndr.get("avg_attempts", 0) or 0), 2),
        source="live",
        recon_date_field="reconciliation_at",
        order_date_field="order_date",
    )


async def get_discrepancies(
    date_from: str | None = None, date_to: str | None = None
) -> DiscrepancyResponse:
    return await live_support.live_or_mock(
        cache=_cache, key=(date_from, date_to), label="discrepancies",
        fetch=lambda: _fetch_live(date_from, date_to), mock=_load_mock,
    )
