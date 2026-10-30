"""Full live-data refresh — the "Fetch Data Now" button and the automatic refresh.

ONE background job re-fetches every dashboard dataset for one date window, through
the SAME service functions the endpoints use, inside mcp_client.fresh_results():
  • 60s-cache datasets (live_or_mock / couriers): a cache entry from before the
    refresh is skipped and the fresh result replaces it. A failure raises instead of
    serving the 'unavailable' fallback, so the old entry is kept untouched.
  • warm-cache datasets (dashboard, claimable, savings, recovery, dispute lines):
    the service's own refresher runs — per-key dedupe, the shared one-heavy-job
    lock, and keep-last-good on failure all apply unchanged.
  • MCP tool calls skip results cached before the refresh but still single-flight
    and take a slot from the global concurrency limit (MCP_MAX_CONCURRENCY).
Only ONE full refresh runs at a time: a manual request while a job runs gets that
job's status back (no duplicate workload), and the scheduler waits for it.

State is in memory (single-worker deploy, like every other cache here), so the
last-refresh times reset when the process restarts.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from types import ModuleType
from typing import Any, Literal

from app.core.config import settings
from app.schemas.refresh import RefreshDatasetStatus, RefreshStatus
from app.services import (
    bills_service,
    cod_service,
    courier_service,
    dashboard_service,
    discrepancy_service,
    export_service,
    live_support,
    mcp_client,
    recovery_service,
    savings_service,
    sla_service,
    status_service,
    trend_service,
    weight_service,
    zone_service,
)

logger = logging.getLogger("refresh")

Trigger = Literal["manual", "scheduled"]

@dataclass(frozen=True)
class _RunCtx:
    since: float  # monotonic start of the refresh: older cached results are not reused
    # Scheduled runs only: a warm-cache result stored after this instant (rebuilt
    # recently by its own scheduler) is reused instead of rebuilt. None = never reuse.
    reuse_after: float | None = None


# (date_from, date_to, ctx) → an optional note on success, raises on failure.
Runner = Callable[[str | None, str | None, _RunCtx], Awaitable[str | None]]

# Light datasets run a few at a time; the heavy warm-cache rebuilds run one after
# another in their own lane (they also serialise on live_support.background_job_sem).
# Real MCP round-trips are bounded by MCP_MAX_CONCURRENCY underneath either way.
_LIGHT_CONCURRENCY = 3
# Heavy lane order: quickest first, so most modules update early (claimable ≈ 260s).
_HEAVY_ORDER = ("dashboard", "trend-recovery", "savings-opportunity", "dispute-lines", "claimable-rate")
_INFLIGHT_POLL_SECONDS = 0.5
_ERROR_MAX_CHARS = 300


class RefreshError(RuntimeError):
    """A dataset could not be refreshed (its previous data is kept)."""


@dataclass(frozen=True)
class _Dataset:
    key: str
    label: str
    module: str
    query_keys: tuple[str, ...]
    run: Runner
    heavy: bool = False
    # Window this dataset is fetched for, from the selected one (dispute lines use
    # their own fixed matured window — see discrepancy_service.matured_window).
    window: Callable[[str | None, str | None], tuple[str | None, str | None]] = field(
        default=lambda f, t: (f, t)
    )


def _live(getter: Callable[[str | None, str | None], Awaitable[Any]]) -> Runner:
    """A 60s-cache dataset: call the endpoint's own service getter under the refresh."""

    async def run(date_from: str | None, date_to: str | None, _ctx: _RunCtx) -> None:
        resp = await getter(date_from, date_to)
        source = getattr(resp, "source", "live")  # /couriers returns a bare list
        if source != "live":
            raise RefreshError(f"Ship MCP returned '{source}' data")

    return run


async def _refresh_warm(
    label: str, module: ModuleType, store_attr: str, inflight_attr: str, refresher_attr: str,
    key: tuple, since: float, reuse_after: float | None = None,
) -> str | None:
    """Rebuild one warm-cache entry via the service's own refresher.

    If a rebuild of the same key is already running (its scheduler, or a stale
    request), wait for it instead of starting a second identical enumeration; it
    counts if it stored a result after this refresh began. With `reuse_after`
    (scheduled runs), a result stored after that instant is reused as-is."""
    store: dict = getattr(module, store_attr)
    inflight: set = getattr(module, inflight_attr)
    accept_after = since if reuse_after is None else min(since, reuse_after)
    attempted = False
    while True:
        while key in inflight:
            await asyncio.sleep(_INFLIGHT_POLL_SECONDS)
        hit = store.get(key)
        if hit is not None and hit[0] >= accept_after:
            if hit[0] >= since:
                return None
            minutes = max(1, round((time.monotonic() - hit[0]) / 60))
            return f"Reused: rebuilt {minutes} min ago by its own scheduler"
        if attempted:
            break
        attempted = True
        await getattr(module, refresher_attr)(key)
    fail = live_support.warm_failures.get((label, key))
    reason = fail[1] if fail is not None and fail[0] >= since else "no result was stored"
    raise RefreshError(f"{reason} — previous data kept")


def _warm(
    label: str, module: ModuleType, store_attr: str, inflight_attr: str, refresher_attr: str,
    key_fn: Callable[[str | None, str | None], tuple] = lambda f, t: (f, t),
) -> Runner:
    async def run(date_from: str | None, date_to: str | None, ctx: _RunCtx) -> str | None:
        return await _refresh_warm(label, module, store_attr, inflight_attr, refresher_attr,
                                   key_fn(date_from, date_to), ctx.since, ctx.reuse_after)

    return run


def _bills_first_page(date_from: str | None, date_to: str | None) -> Awaitable[Any]:
    # The Bills page's default view: page 1, 10 rows, newest first, no filters.
    return bills_service.list_bills(page=1, page_size=10, date_from=date_from, date_to=date_to)


def _lines_key(_f: str | None, _t: str | None) -> tuple:
    mf, mt = discrepancy_service.matured_window()
    return (mf, mt, discrepancy_service._LINES_DEFAULT_MIN_DIFF)


def _datasets() -> list[_Dataset]:
    """Every dataset behind the dashboard modules. query_keys are the frontend's
    TanStack Query roots for the panels each dataset feeds."""
    return [
        _Dataset("dashboard", "KPIs, distribution & state cost", "Dashboard", ("dashboard",),
                 _warm("dashboard", dashboard_service, "_dashboard_warm", "_dashboard_inflight",
                       "_refresh_dashboard"), heavy=True),
        _Dataset("dashboard-rate-diff", "Pending reconciliation", "Dashboard", ("dashboard-rate-diff",),
                 _live(dashboard_service.get_rate_diff)),
        _Dataset("dashboard-courier-billing", "Courier billing breakdown", "Dashboard",
                 ("dashboard-courier-billing",), _live(dashboard_service.get_courier_billing)),
        _Dataset("claimable-rate", "Claimable rate difference", "Dashboard", ("claimable-rate",),
                 _warm("claimable", discrepancy_service, "_claimable_warm", "_claimable_inflight",
                       "_refresh_claimable"), heavy=True),
        _Dataset("bills", "Bills (first page)", "Bills", ("bills",), _live(_bills_first_page)),
        _Dataset("couriers", "Courier comparison", "Courier Comparison", ("couriers",),
                 _live(courier_service.list_couriers)),
        _Dataset("discrepancies", "Discrepancy panels", "Discrepancies", ("discrepancies",),
                 _live(discrepancy_service.get_discrepancies)),
        _Dataset("reconciliation", "Reconciliation detail", "Discrepancies", ("reconciliation",),
                 _live(discrepancy_service.get_reconciliation)),
        _Dataset("savings-opportunity", "Savings opportunity", "Discrepancies", ("savings-opportunity",),
                 _warm("savings", savings_service, "_cache", "_savings_inflight", "_refresh_savings"),
                 heavy=True),
        _Dataset("dispute-lines", "Dispute lines (last full month, ₹100+)", "Dispute Lines",
                 ("dispute-lines", "dispute-invoices"),
                 _warm("dispute-lines", discrepancy_service, "_lines_cache", "_lines_inflight",
                       "_refresh_lines", key_fn=_lines_key),
                 heavy=True, window=lambda f, t: _lines_key(f, t)[:2]),
        _Dataset("cod", "COD overview", "COD", ("cod",), _live(cod_service.get_cod)),
        _Dataset("cod-pending", "COD pending by courier", "COD", ("cod-pending",),
                 _live(cod_service.get_cod_pending)),
        _Dataset("cod-intelligence", "COD intelligence", "COD", ("cod-intelligence",),
                 _live(cod_service.get_cod_intelligence)),
        _Dataset("sla-performance", "Delivery SLA", "Delivery Performance", ("sla-performance",),
                 _live(sla_service.get_sla)),
        _Dataset("zones", "State analysis", "State Analysis", ("zones",), _live(zone_service.get_zones)),
        _Dataset("weight", "Weight analysis", "Weight Analysis", ("weight",),
                 _live(weight_service.get_weight)),
        _Dataset("trend", "Monthly trend", "Trend Analysis", ("trend",), _live(trend_service.get_trend)),
        _Dataset("trend-recovery", "Recovery trend", "Trend Analysis", ("trend-recovery",),
                 _warm("recovery", recovery_service, "_recovery_warm", "_recovery_inflight",
                       "_refresh_recovery"), heavy=True),
    ]


# --- Job state ------------------------------------------------------------------
_status = RefreshStatus()
_task: asyncio.Task | None = None
_next_scheduled_at: datetime | None = None
_bg_tasks: set[asyncio.Task] = set()


def _now() -> datetime:
    return datetime.now(UTC)


def is_running() -> bool:
    return _task is not None and not _task.done()


def get_status() -> RefreshStatus:
    return _status.model_copy(
        deep=True,
        update={
            "running": is_running(),
            "auto_refresh_enabled": settings.auto_refresh_enabled,
            "interval_hours": settings.auto_refresh_interval_hours,
            "next_scheduled_at": _next_scheduled_at if settings.auto_refresh_enabled else None,
        },
    )


def _safe_error(exc: BaseException, *, dataset_timed_out: bool = False) -> str:
    if dataset_timed_out:
        msg = f"Timed out after {settings.refresh_dataset_timeout_seconds:.0f}s"
    elif isinstance(exc, RefreshError):
        msg = str(exc)
    else:
        msg = live_support.describe_error(exc)
    msg = mcp_client._mask(msg)  # never echo the MCP token
    return msg if len(msg) <= _ERROR_MAX_CHARS else msg[: _ERROR_MAX_CHARS - 1] + "…"


def _invalidate_derived(date_from: str | None, date_to: str | None) -> None:
    """Drop caches BUILT FROM the refreshed datasets so they rebuild from fresh data:
    rendered export files for this window and the MCP status snapshot."""
    for k in [k for k in export_service._render_cache if k[2:] == (date_from, date_to)]:
        export_service._render_cache.pop(k, None)
    status_service._cache.clear()


async def _run_dataset(ds: _Dataset, st: RefreshDatasetStatus, date_from: str | None,
                       date_to: str | None, ctx: _RunCtx) -> None:
    st.status = "running"
    t0 = time.perf_counter()
    deadline = asyncio.timeout(settings.refresh_dataset_timeout_seconds)
    try:
        async with deadline:
            st.note = await ds.run(date_from, date_to, ctx)
        st.status = "success"
    except Exception as exc:  # noqa: BLE001 — one dataset's failure never stops the rest
        st.status = "failed"
        st.error = _safe_error(exc, dataset_timed_out=deadline.expired())
        _status.failed += 1
        logger.warning("refresh: %s failed — %s", ds.key, st.error)
    finally:
        st.duration_ms = int((time.perf_counter() - t0) * 1000)
        _status.completed += 1


async def _run_job(datasets: list[_Dataset], date_from: str | None, date_to: str | None,
                   reuse_after: float | None = None) -> None:
    by_key = {st.key: st for st in _status.datasets}
    # Count this job's MCP work (requested vs real round-trips); every dataset task
    # inherits this context, so all their tool calls land on the same counters.
    stats = mcp_client.begin_request_stats()
    try:
        # Fresh reads + the longer background per-call timeout (no request waits on
        # this job; weight_reconciliation_summary alone takes ~45-75s).
        with mcp_client.fresh_results() as since, live_support.background_timeout():
            ctx = _RunCtx(since=since, reuse_after=reuse_after)
            light_sem = asyncio.Semaphore(_LIGHT_CONCURRENCY)

            async def light(ds: _Dataset) -> None:
                async with light_sem:
                    await _run_dataset(ds, by_key[ds.key], date_from, date_to, ctx)

            async def heavy_lane() -> None:
                heavy = sorted((d for d in datasets if d.heavy),
                               key=lambda d: _HEAVY_ORDER.index(d.key) if d.key in _HEAVY_ORDER else 99)
                for ds in heavy:
                    await _run_dataset(ds, by_key[ds.key], date_from, date_to, ctx)

            await asyncio.gather(heavy_lane(), *(light(d) for d in datasets if not d.heavy))
    finally:
        _status.mcp_requests = stats.calls
        _status.mcp_round_trips = stats.real_calls
        _status.mcp_deduplicated = stats.cache_hits
        _finish(date_from, date_to)


def _finish(date_from: str | None, date_to: str | None) -> None:
    ok = [d for d in _status.datasets if d.status == "success"]
    bad = [d for d in _status.datasets if d.status != "success"]
    for d in bad:  # a cancelled job leaves pending/running rows — report them as failed
        if d.status != "failed":
            d.status, d.error = "failed", d.error or "Refresh was interrupted — previous data kept"
    _status.failed = len(bad)
    _status.completed = len(_status.datasets)
    _status.finished_at = _now()
    if not bad:
        _status.state = "success"
        _status.last_success_at = _status.finished_at
        _status.last_success_from, _status.last_success_to = date_from, date_to
        _status.last_error = None
    else:
        _status.state = "partial" if ok else "failed"
        names = ", ".join(d.label for d in bad)
        _status.last_error = (
            f"{len(bad)} of {len(_status.datasets)} datasets failed ({names}). "
            "Their previous data was kept."
        )
    if ok:
        _invalidate_derived(date_from, date_to)
    logger.info("refresh #%d %s: %d ok, %d failed (window %s..%s)",
                _status.job_id, _status.state, len(ok), len(bad), date_from, date_to)
    live_support.fetch_logger.info(
        "refresh #%d finished trigger=%s range=%s..%s state=%s ok=%d failed=%d "
        "mcp_requests=%d mcp_round_trips=%d deduplicated=%d finished_at=%s",
        _status.job_id, _status.trigger, date_from, date_to, _status.state, len(ok), len(bad),
        _status.mcp_requests, _status.mcp_round_trips, _status.mcp_deduplicated,
        _status.finished_at.isoformat(timespec="seconds"))


def start_refresh(
    *, trigger: Trigger, date_from: str | None, date_to: str | None, triggered_by: str | None = None,
) -> tuple[bool, RefreshStatus]:
    """Start a full refresh for the window, or return (False, status) if one is
    already running. Must be called from the event loop."""
    global _task, _status
    if is_running():
        return False, get_status()
    datasets = _datasets()
    started = _now()
    _status = RefreshStatus(
        job_id=_status.job_id + 1,
        state="running",
        trigger=trigger,
        triggered_by=triggered_by,
        date_from=date_from,
        date_to=date_to,
        started_at=started,
        total=len(datasets),
        datasets=[
            RefreshDatasetStatus(
                key=d.key, label=d.label, module=d.module, query_keys=list(d.query_keys),
                date_from=d.window(date_from, date_to)[0], date_to=d.window(date_from, date_to)[1],
            )
            for d in datasets
        ],
        last_attempt_at=started,
        # carried over from the previous job
        last_success_at=_status.last_success_at,
        last_success_from=_status.last_success_from,
        last_success_to=_status.last_success_to,
        last_error=None,
    )
    logger.info("refresh #%d started (%s%s) for %s..%s — %d datasets", _status.job_id, trigger,
                f" by {triggered_by}" if triggered_by else "", date_from, date_to, len(datasets))
    live_support.fetch_logger.info(
        "refresh #%d started trigger=%s%s range=%s..%s datasets=%d bypass_cache_before=%s",
        _status.job_id, trigger, f" by={triggered_by}" if triggered_by else "", date_from, date_to,
        len(datasets), started.isoformat(timespec="seconds"))
    # Only the automatic run may reuse a slow dataset its own scheduler just rebuilt;
    # "Fetch Data Now" always fetches everything fresh.
    reuse_after = (time.monotonic() - settings.auto_refresh_reuse_seconds
                   if trigger == "scheduled" and settings.auto_refresh_reuse_seconds > 0 else None)
    _task = asyncio.create_task(_run_job(datasets, date_from, date_to, reuse_after))
    _bg_tasks.add(_task)
    _task.add_done_callback(_bg_tasks.discard)
    return True, get_status()


async def wait_for_current() -> None:
    """Wait until the running job (if any) finishes, without raising its errors."""
    if _task is not None and not _task.done():
        await asyncio.wait({_task})


# --- Automatic refresh ----------------------------------------------------------
def default_window() -> tuple[str, str]:
    """The frontend's default 'Last 30 Days' window, on the users' calendar day."""
    today: date = (_now() + timedelta(minutes=settings.auto_refresh_utc_offset_minutes)).date()
    return (today - timedelta(days=29)).isoformat(), today.isoformat()


def _recently_refreshed(date_from: str, date_to: str) -> bool:
    """The last job (manual or automatic) fully refreshed this window within the
    reuse period — running again now would only repeat the same MCP requests."""
    return (
        _status.state == "success"
        and (_status.date_from, _status.date_to) == (date_from, date_to)
        and _status.finished_at is not None
        and (_now() - _status.finished_at).total_seconds() < settings.auto_refresh_reuse_seconds
    )


async def run_scheduled_refresh() -> bool:
    """One automatic run for the default window. If a refresh is already running,
    wait for it rather than starting a duplicate — and if it covers the same window,
    it counts as this run. Returns True if this call ran its own job."""
    date_from, date_to = default_window()
    if is_running():
        running_window = (_status.date_from, _status.date_to)
        logger.info("refresh: scheduled run waiting for the running refresh #%d", _status.job_id)
        await wait_for_current()
        if running_window == (date_from, date_to):
            return False
    if _recently_refreshed(date_from, date_to):
        logger.info("refresh: scheduled run skipped — %s..%s was fully refreshed %s",
                    date_from, date_to, _status.finished_at)
        return False
    accepted, _ = start_refresh(trigger="scheduled", date_from=date_from, date_to=date_to)
    if not accepted:  # another job started while we waited — let it stand in for this run
        await wait_for_current()
        return False
    await wait_for_current()
    return True


async def _scheduler() -> None:
    global _next_scheduled_at
    interval = max(60.0, settings.auto_refresh_interval_hours * 3600)
    logger.info("refresh: automatic full refresh every %.0f min (first in %.0fs)",
                interval / 60, settings.auto_refresh_initial_delay_seconds)
    next_run = time.monotonic() + max(0.0, settings.auto_refresh_initial_delay_seconds)
    while True:
        delay = max(0.0, next_run - time.monotonic())
        _next_scheduled_at = _now() + timedelta(seconds=delay)
        await asyncio.sleep(delay)
        next_run += interval  # fixed cadence, independent of how long a run takes
        if settings.mcp_connect_url:
            try:
                await run_scheduled_refresh()
            except Exception:  # noqa: BLE001 — the scheduler loop must never die
                logger.exception("refresh: scheduled run crashed")
        if next_run <= time.monotonic():  # a run longer than the interval: skip missed ticks
            next_run = time.monotonic() + interval


def start_refresh_scheduler() -> None:
    """Launch the automatic refresh loop (called from app startup)."""
    if not settings.auto_refresh_enabled:
        logger.info("refresh: automatic refresh disabled (AUTO_REFRESH_ENABLED=false)")
        return
    task = asyncio.create_task(_scheduler())
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
