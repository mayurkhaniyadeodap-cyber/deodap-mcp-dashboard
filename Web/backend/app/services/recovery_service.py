"""Cumulative "rate difference identified" — SLOW compute, served warm.

Per-month weight_reconciliation_summary.fwd_rate_diff (7× ≈ 27s), cumulatively
summed. Concurrency-capped at 3; a failed month is a GAP (not zero); the newest
month is partial. The numbers/labels/basis are UNCHANGED — we deliberately keep
fwd_rate_diff (the three over-invoicing tools still don't reconcile; see
docs/backlog note), reconciliation_at basis.

The only change vs before: the ~27s enumeration NEVER runs on the request path.
A background scheduler recomputes the active window every 10 min and stores the
last good series; the endpoint only ever reads that store (same warm-cache pattern
as the claimable KPI). Empty mock fallback + source flag preserved.
"""

import asyncio
import logging
import time

from app.schemas.recovery import RecoveryPoint, RecoveryResponse
from app.services import live_support, mcp_client
from app.services.date_windows import month_windows

logger = logging.getLogger("live")
_TTL_SECONDS = 600  # 10 min — matches the background refresh cadence

# Warm store: (from,to) -> (monotonic_ts, series). The 7× enumeration is kept OFF
# the request path — the endpoint always serves a stored series instantly.
_recovery_warm: dict[tuple, tuple[float, RecoveryResponse]] = {}
_recovery_primary_key: tuple = (None, None)  # window the scheduler keeps hot (last requested)
_recovery_inflight: set[tuple] = set()        # windows currently being computed (dedupe)
# One enumeration at a time; each is internally capped at 3 concurrent month calls,
# so recovery can never monopolise the (session-per-request) MCP client.
_recovery_job_sem = asyncio.Semaphore(1)
_bg_tasks: set[asyncio.Task] = set()  # keep fire-and-forget refresh tasks referenced


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


# --- Warm-cache serving + background scheduler (compute never runs inline) ------


class _recovery_inflight_guard:
    """Async context manager: registers `key` as in-flight; yields False if it was
    already registered (so the caller can bail without double-computing)."""

    def __init__(self, key: tuple):
        self.key = key

    async def __aenter__(self) -> bool:
        if self.key in _recovery_inflight:
            self.acquired = False
        else:
            _recovery_inflight.add(self.key)
            self.acquired = True
        return self.acquired

    async def __aexit__(self, *exc) -> None:
        if self.acquired:
            _recovery_inflight.discard(self.key)


async def _refresh_recovery(key: tuple) -> None:
    """Recompute one window's series and store it. Deduped per window, serialised
    across windows (job semaphore). On failure the last good series is kept —
    never overwritten, never a spinner."""
    async with _recovery_inflight_guard(key) as acquired:
        if not acquired:  # another refresh for this window is already running
            return
        async with _recovery_job_sem:  # one heavy 7× enumeration at a time
            try:
                series = await _fetch_live(*key)
                _recovery_warm[key] = (time.monotonic(), series)
                logger.info("recovery: warm refresh done for window=%s → %d points", key, len(series.points))
            except Exception:  # noqa: BLE001 — keep last good, log, never fabricate
                logger.exception("recovery: warm refresh failed for %s; keeping last good", key)


def _spawn_refresh(key: tuple) -> None:
    task = asyncio.create_task(_refresh_recovery(key))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


async def _recovery_scheduler() -> None:
    """Background loop: keep the active (most-recently-requested) window hot by
    recomputing it every TTL. Started once at app startup."""
    logger.info("recovery: scheduler started (every %ds)", _TTL_SECONDS)
    while True:
        if live_support.settings.mcp_connect_url:
            await _refresh_recovery(_recovery_primary_key)
        await asyncio.sleep(_TTL_SECONDS)


def start_recovery_scheduler() -> None:
    """Launch the warm-refresh loop (called from app startup)."""
    task = asyncio.create_task(_recovery_scheduler())
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


async def get_recovery(date_from: str | None = None, date_to: str | None = None) -> RecoveryResponse:
    """Serve the recovery series INSTANTLY from the warm store — the ~27s
    enumeration never runs inline. Behaviour mirrors the claimable KPI:
      • warm & fresh for this window → return it.
      • warm but stale              → return it, flag recalculating, kick a bg refresh.
      • no series for this window    → return the primary window's last good series
                                       (flag recalculating) + queue this window; if
                                       nothing warm at all → computing.
    """
    if not live_support.settings.mcp_connect_url:
        logger.warning("recovery: Ship MCP not configured — empty series.")
        return _mock()

    global _recovery_primary_key
    key = (date_from, date_to)
    _recovery_primary_key = key  # scheduler keeps whatever users are viewing hot
    now = time.monotonic()

    hit = _recovery_warm.get(key)
    if hit is not None:
        ts, series = hit
        if (now - ts) < _TTL_SECONDS:
            return series
        _spawn_refresh(key)  # stale → refresh in background, serve the warm series now
        return series.model_copy(update={"recalculating": True})

    # Nothing for this window yet — never block. Compute it in the background and
    # meanwhile serve the last good series from any warm window (flagged), or a
    # "computing" placeholder if the very first run hasn't finished.
    _spawn_refresh(key)
    fallback = _recovery_warm.get((None, None)) or next(iter(_recovery_warm.values()), None)
    if fallback is not None:
        return fallback[1].model_copy(update={"recalculating": True})
    return RecoveryResponse(points=[], source="mock", computing=True)
