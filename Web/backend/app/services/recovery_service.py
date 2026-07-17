"""Cumulative "rate difference identified" — SLOW, own 10-min cache endpoint.

Per-month weight_reconciliation_summary.fwd_rate_diff (7× ≈ 27s), cumulatively
summed. Concurrency-capped at 3; a failed month is a GAP (not zero); the newest
month is partial. Separate endpoint so the fast Trend charts never wait on it.
"""

import asyncio
import logging
import time

from app.schemas.recovery import RecoveryPoint, RecoveryResponse
from app.services import live_support, mcp_client
from app.services.date_windows import month_windows

logger = logging.getLogger("live")
_TTL_SECONDS = 600  # 10 min
_cache: dict[tuple, tuple[float, RecoveryResponse]] = {}


def _mock() -> RecoveryResponse:
    return RecoveryResponse(points=[], source="mock")


async def _month_diff(ws: str, we: str, sem: asyncio.Semaphore) -> float | None:
    async with sem:
        try:
            d = live_support.parse_tool_json(
                await mcp_client.call_tool("weight_reconciliation_summary", {"from": ws, "to": we})
            )
        except Exception:  # noqa: BLE001 — a failed month is a gap
            return None
    return round(float(d.get("fwd_rate_diff", 0) or 0), 2)


async def _fetch_live(date_from: str | None, date_to: str | None) -> RecoveryResponse:
    windows = month_windows(date_from, date_to)
    sem = asyncio.Semaphore(3)
    diffs = await asyncio.gather(*[_month_diff(ws, we, sem) for _, ws, we, _ in windows])

    points: list[RecoveryPoint] = []
    cumulative = 0.0
    for (label, _ws, _we, partial), diff in zip(windows, diffs):
        gap = diff is None
        identified = 0.0 if gap else diff
        cumulative = round(cumulative + identified, 2)
        points.append(RecoveryPoint(
            month=label, identified=identified, cumulative=cumulative, partial=partial, gap=gap,
        ))
    return RecoveryResponse(points=points, source="live", date_field="reconciliation_at")


async def get_recovery(date_from: str | None = None, date_to: str | None = None) -> RecoveryResponse:
    key = (date_from, date_to)
    now = time.monotonic()
    cached = _cache.get(key)
    if cached is not None and (now - cached[0]) < _TTL_SECONDS:
        return cached[1]
    if not live_support.settings.mcp_connect_url:
        logger.warning("recovery: Ship MCP not configured — empty series.")
        return _mock()
    try:
        result = await _fetch_live(date_from, date_to)
        _cache[key] = (now, result)
        return result
    except Exception as exc:  # noqa: BLE001
        logger.warning("recovery: Ship MCP unavailable (%s) — empty series.", exc)
        return _mock()
