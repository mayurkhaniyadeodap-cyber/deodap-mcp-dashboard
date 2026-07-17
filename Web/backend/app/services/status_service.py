"""MCP status service (GET /api/_status).

Probes every dashboard endpoint CONCURRENTLY by calling its existing service
function and reading the per-response `source` field it already returns — no new
MCP calls beyond what each endpoint normally makes, no new data sources. Result
is cached 60s. The two slow endpoints (savings-opportunity, trend-recovery) are
skipped unless include_slow=True.

`mcp_tools` and `notes` are hand-filled from what each service ACTUALLY calls
(verified against the service source), not guessed.
"""

import asyncio
import logging
from time import monotonic, perf_counter
from typing import Awaitable, Callable

from app.core.config import settings
from app.schemas.status import EndpointStatus, StatusResponse
from app.services import (
    cod_service,
    courier_service,
    discrepancy_service,
    mcp_client,
    recovery_service,
    savings_service,
    trend_service,
    weight_service,
    zone_service,
)
from app.services import dashboard_service
def _safe_mcp_url() -> str:
    """Base MCP URL with the token param fully redacted — never even a prefix."""
    if not settings.mcp_url:
        return "(not configured)"
    sep = "&" if "?" in settings.mcp_url else "?"
    return f"{settings.mcp_url}{sep}mcp_token=***REDACTED***"

logger = logging.getLogger("live")

_TTL_SECONDS = 60.0
_cache: dict[bool, tuple[float, StatusResponse]] = {}


async def _source_of(coro: Awaitable) -> str:
    """Await a service getter and read its per-response `source` field."""
    resp = await coro
    return "live" if getattr(resp, "source", "mock") == "live" else "mock"


async def _couriers_source() -> str:
    """/api/couriers returns a bare list[Courier] (no `source` field), so mirror
    what list_couriers() decides internally: live if _fetch_live succeeds, else
    mock. Same single MCP round-trip the endpoint itself makes."""
    try:
        await courier_service._fetch_live(None, None)
        return "live"
    except Exception:
        return "mock"


# (endpoint, mcp_tools, notes, source-probe factory, is_slow) — tools/notes are
# verified against each service's actual call_tool()/sample_orders() usage.
def _specs() -> list[tuple[str, list[str], str, Callable[[], Awaitable[str]], bool]]:
    return [
        (
            "/api/couriers",
            ["courier_performance", "order_analytics", "rto_analysis", "shipping_cost_summary"],
            "Per-courier freight/RTO/COD from population tools; RTO% = rto_analysis ÷ order_analytics (matches Discrepancies).",
            _couriers_source,
            False,
        ),
        (
            "/api/dashboard",
            ["order_analytics", "shipping_cost_summary", "cod_remittance_summary", "sla_performance"],
            "KPIs + distribution + state cost. Deltas use complete prior windows (order-placement metrics only); lagged KPIs show no delta.",
            lambda: _source_of(dashboard_service.get_dashboard()),
            False,
        ),
        (
            "/api/dashboard/rate-diff",
            ["weight_reconciliation_summary"],
            "Forward rate difference to investigate. Reconciliation lags (reconciliation_at) → no delta. Own 60s cache.",
            lambda: _source_of(dashboard_service.get_rate_diff()),
            False,
        ),
        (
            "/api/dashboard/courier-billing",
            ["list_orders", "shipping_cost_summary"],
            "Sampled rate_summary (Base Freight / GST / COD) via list_orders + population RTO from shipping_cost_summary. Fuel folded into base freight.",
            lambda: _source_of(dashboard_service.get_courier_billing()),
            False,
        ),
        (
            "/api/cod",
            ["order_analytics", "cod_remittance_summary"],
            "Global remittance only — per-courier remitted/pending unavailable (cod_remittance_summary has no group_by). Remittance lags → no delta on remitted/pending.",
            lambda: _source_of(cod_service.get_cod()),
            False,
        ),
        (
            "/api/zones",
            ["shipping_cost_summary", "geo_performance"],
            "State-level cost (shipping_cost_summary group_by=state) + geo_performance. No canonical zone dimension → replaced by State Analysis.",
            lambda: _source_of(zone_service.get_zones()),
            False,
        ),
        (
            "/api/weight",
            ["weight_reconciliation_summary", "list_orders"],
            "Reconciliation summary (global by_status) + sampled list_orders for scatter/histogram. Reconciliation lags a few days.",
            lambda: _source_of(weight_service.get_weight()),
            False,
        ),
        (
            "/api/discrepancies",
            ["order_analytics", "rto_analysis", "ndr_analysis", "weight_reconciliation_summary"],
            "RTO (rto_analysis ÷ order_analytics) live; weight cases / overcharging alerts are sampled.",
            lambda: _source_of(discrepancy_service.get_discrepancies()),
            False,
        ),
        (
            "/api/trend",
            ["daily_booking_trend", "shipping_cost_summary"],
            "Monthly trend. Per-courier breakdown unavailable — daily_booking_trend ignores group_by.",
            lambda: _source_of(trend_service.get_trend()),
            False,
        ),
        (
            "/api/trend-recovery",
            ["weight_reconciliation_summary"],
            "7× weight_reconciliation_summary across months (~27s). Own 10-min cache. SLOW.",
            lambda: _source_of(recovery_service.get_recovery()),
            True,
        ),
        (
            "/api/savings-opportunity",
            ["pincode_serviceability", "order_analytics", "rto_analysis", "list_orders"],
            "pincode_serviceability (~9s p95) + others. Own 30-min cache. SLOW.",
            lambda: _source_of(savings_service.get_savings_opportunity()),
            True,
        ),
    ]


async def _probe(endpoint: str, tools: list[str], notes: str, factory: Callable[[], Awaitable[str]]) -> EndpointStatus:
    t0 = perf_counter()
    try:
        source = await factory()
    except Exception as exc:  # noqa: BLE001 — a failed probe is a mock reading, not a 500
        logger.warning("status probe %s failed (%s) — reporting mock", endpoint, exc)
        source = "mock"
    load_ms = int((perf_counter() - t0) * 1000)
    return EndpointStatus(endpoint=endpoint, source=source, mcp_tools=tools, load_ms=load_ms, notes=notes)


async def _mcp_header() -> tuple[bool, int]:
    try:
        tools = await mcp_client.list_tools()
        return True, len(tools)
    except Exception as exc:  # noqa: BLE001
        logger.warning("status: list_tools failed (%s)", exc)
        return False, 0


async def _fetch(include_slow: bool) -> StatusResponse:
    specs = [s for s in _specs() if include_slow or not s[4]]
    header_task = asyncio.create_task(_mcp_header())
    probes = await asyncio.gather(*[_probe(ep, tools, notes, fn) for ep, tools, notes, fn, _slow in specs])
    mcp_connected, tool_count = await header_task
    return StatusResponse(
        mcp_connected=mcp_connected,
        mcp_url=_safe_mcp_url(),
        tool_count=tool_count,
        token_present=bool(settings.mcp_token),
        endpoints=probes,
    )


async def get_status(include_slow: bool = False) -> StatusResponse:
    now = monotonic()
    hit = _cache.get(include_slow)
    if hit and now - hit[0] < _TTL_SECONDS:
        return hit[1]
    result = await _fetch(include_slow)
    _cache[include_slow] = (now, result)
    return result
