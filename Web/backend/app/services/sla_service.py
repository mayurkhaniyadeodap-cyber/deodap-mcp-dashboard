"""Delivery SLA performance service — live via MCP with honest unavailable fallback.

sla_performance → delivered / on_time / late / on_time_pct / avg_delay_days /
overdue_in_transit for the selected window. Own 60s cache (live_support.live_or_mock).
On MCP failure the fallback is an empty source="unavailable" response — there is no
SLA fixture, so nothing is ever fabricated (USE_MOCK_FALLBACK has no fixture to load).
"""

import logging

from app.schemas.sla import SlaResponse
from app.services import live_support, mcp_client

logger = logging.getLogger("live")
_cache = live_support.new_cache()


def _mock() -> SlaResponse:
    # Honest "unavailable" (zeros) — never fabricated SLA numbers.
    return SlaResponse(source="unavailable")


async def _fetch_live(date_from: str | None, date_to: str | None) -> SlaResponse:
    args = live_support.date_args(date_from, date_to)
    d = live_support.parse_tool_json(await mcp_client.call_tool("sla_performance", args))
    return SlaResponse(
        delivered=int(d.get("delivered", 0) or 0),
        on_time=int(d.get("on_time", 0) or 0),
        late=int(d.get("late", 0) or 0),
        on_time_pct=round(float(d.get("on_time_pct", 0) or 0), 2),
        avg_delay_days=round(float(d.get("avg_delay_days", 0) or 0), 2),
        overdue_in_transit=int(d.get("overdue_in_transit", 0) or 0),
        source="live",
        date_field=str(d.get("date_field") or "order_date"),
    )


async def get_sla(date_from: str | None = None, date_to: str | None = None) -> SlaResponse:
    return await live_support.live_or_mock(
        cache=_cache, key=(date_from, date_to), label="sla-performance",
        fetch=lambda: _fetch_live(date_from, date_to), mock=_mock,
    )
