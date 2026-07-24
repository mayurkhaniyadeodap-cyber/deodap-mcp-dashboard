"""Discrepancies service — live via MCP with mock fallback.

  rate_diff: weight_reconciliation_summary (aggregate reconciliation lines).
  rto:  rto_analysis.by_courier.count ÷ order_analytics(courier).orders.
  ndr:  ndr_analysis.by_courier.count ÷ order_analytics(courier).orders.
Couriers with no RTO/NDR render 0.0% (kept, not dropped). Per-AWB weight cases /
overcharging ₹ do not exist and are not faked. Savings is a separate endpoint.
"""

import asyncio
import logging
import time
from datetime import date, timedelta

from app.core.config import settings
from app.schemas.discrepancies import CourierRate, DiscrepancyResponse, RateDiff
from app.schemas.dispute_lines import (
    DisputeInvoiceGroup,
    DisputeInvoicesResponse,
    DisputeLine,
    DisputeLinesResponse,
)
from app.schemas.reconciliation import (
    ClaimableRateResponse,
    RateDispute,
    ReconciledCourier,
    ReconciliationResponse,
    WeightDispute,
)
from app.services import live_support, mcp_client
from app.services.courier_service import _name_and_code, _norm
from app.utils.mock import load_mock

logger = logging.getLogger("live")

_cache = live_support.new_cache()


def _load_mock() -> DiscrepancyResponse:
    # Honest "unavailable" (empty) by default — fixtures only in dev (USE_MOCK_FALLBACK).
    if settings.use_mock_fallback:
        return DiscrepancyResponse(**load_mock("discrepancies.json"))
    return DiscrepancyResponse(
        rate_diff=RateDiff(reconciliation_lines=0, weight_overcharged=0, weight_diff_kg=0.0,
                           fwd_rate_diff=0.0, reconciled=0, disputed=0, has_recon=False),
        rto=[], ndr=[], ndr_orders=0, ndr_avg_attempts=0.0, source="unavailable",
    )


def _per_courier(orders_by_slug: dict[str, int], counts_by_slug: dict[str, int]) -> list[CourierRate]:
    """Rate per courier over ALL couriers with orders (0.0% when count is 0)."""
    rows = [
        CourierRate(
            courier=_name_and_code(slug)[0],
            orders=orders,
            count=counts_by_slug.get(slug, 0),
            rate_pct=live_support.rate_pct(counts_by_slug.get(slug, 0), orders),
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


# --- Reconciliation detail (additive, slow) — per-AWB weight/rate mismatches +
#     per-courier reconciled totals. Own cache; existing endpoints untouched. -----
_recon_cache = live_support.new_cache()
_DISPUTE_LIMIT = 100  # top-N by magnitude (there are tens of thousands)


def _reconciliation_mock() -> ReconciliationResponse:
    # Empty on fallback — never fabricate AWBs / couriers / amounts.
    return ReconciliationResponse(source="unavailable")


async def _reconciliation_live(date_from: str | None, date_to: str | None) -> ReconciliationResponse:
    args = live_support.date_args(date_from, date_to)
    wd_r, rd_r, rec_r = await asyncio.gather(
        mcp_client.call_tool("reconciliation_disputes",
                             {**args, "weight_status": "Mismatched", "sort_by": "weight_diff", "limit": _DISPUTE_LIMIT}),
        mcp_client.call_tool("reconciliation_disputes",
                             {**args, "rate_status": "Mismatched", "sort_by": "rate_diff", "limit": _DISPUTE_LIMIT}),
        mcp_client.call_tool("reconciliation_summary", {**args, "group_by": "courier", "status": "Reconciled"}),
    )
    wd = live_support.parse_tool_json(wd_r)
    rd = live_support.parse_tool_json(rd_r)
    rec = live_support.parse_tool_json(rec_r)

    weight_disputes = [
        WeightDispute(
            awb=str(x.get("awb", "")), courier=str(x.get("courier", "")),
            expected_weight_kg=round(float(x.get("applied_weight_kg", 0) or 0), 3),
            billed_weight_kg=round(float(x.get("invoiced_weight_kg", 0) or 0), 3),
            weight_diff_kg=round(float(x.get("weight_diff_kg", 0) or 0), 3),
            status=str(x.get("recon_status", "")),
        )
        for x in wd.get("rows", []) or []
    ]
    rate_disputes = [
        RateDispute(
            awb=str(x.get("awb", "")), courier=str(x.get("courier", "")),
            applied_rate=round(float(x.get("applied_shipping_rate", 0) or 0), 2),
            invoiced_rate=round(float(x.get("invoiced_shipping_rate", 0) or 0), 2),
            rate_diff=round(float(x.get("rate_diff", 0) or 0), 2),
        )
        for x in rd.get("rows", []) or []
    ]
    reconciled = [
        ReconciledCourier(
            courier=str(b.get("group", "")),
            reconciled_lines=int(b.get("rows", 0) or 0),
            reconciled_amount=round(float(b.get("invoiced_rate", 0) or 0), 2),
        )
        for b in rec.get("breakdown", []) or []
        if b.get("group") and b.get("group") != "(none)"
    ]
    reconciled.sort(key=lambda r: r.reconciled_amount, reverse=True)

    return ReconciliationResponse(
        weight_disputes=weight_disputes, weight_total=int(wd.get("total_matched", 0) or 0),
        rate_disputes=rate_disputes, rate_total=int(rd.get("total_matched", 0) or 0),
        reconciled=reconciled, source="live", date_field="order_date",
    )


async def get_reconciliation(
    date_from: str | None = None, date_to: str | None = None
) -> ReconciliationResponse:
    return await live_support.live_or_mock(
        cache=_recon_cache, key=(date_from, date_to), label="reconciliation",
        fetch=lambda: _reconciliation_live(date_from, date_to), mock=_reconciliation_mock,
    )


# --- Claimable rate difference (Task 2) ----------------------------------------
# The old headline was weight_reconciliation_summary.fwd_rate_diff (≈₹33.4L gross),
# which counts every rate mismatch as recoverable. It isn't: ~17% of ≥₹100 mismatch
# ₹ sit on rows with applied_shipping_rate = 0 (unpriced heavy shipments — the WHOLE
# invoice reads as an overcharge, so nothing is genuinely claimable), and a long tail
# of sub-₹50 diffs is rounding noise. Claimable = Σ rate_diff over rows that clear the
# ₹50 threshold AND actually carry an applied rate. Excluded buckets are surfaced,
# never dropped ("nothing should disappear"). Reconciliation-book basis, so
# date_field=reconciliation_at.
_CLAIMABLE_THRESHOLD = 50.0
_CLAIMABLE_PAGE = 500  # reconciliation_disputes caps limit at 500
_CLAIMABLE_CONCURRENCY = 4
_CLAIMABLE_TTL_SECONDS = 1800  # 30 min (matches the background refresh cadence)

# Warm store: (from,to) -> (monotonic_ts, result). The ~260s enumeration NEVER runs
# inline on a request — a background scheduler keeps the active window hot and the
# endpoint always serves a stored figure instantly.
_claimable_warm: dict[tuple, tuple[float, ClaimableRateResponse]] = {}
_claimable_primary_key: tuple = (None, None)  # window the scheduler keeps hot (last requested)
_claimable_inflight: set[tuple] = set()        # windows currently being computed (dedupe)
# Only ONE enumeration at a time — caps total claimable-driven MCP load at
# _CLAIMABLE_CONCURRENCY (4), same as today's inline behaviour, so a background
# refresh can never monopolise the (session-per-request) MCP client.
# Heavy enumerations share ONE global cap (live_support.background_job_sem) so
# claimable / dispute-lines / recovery can't run concurrently and saturate the MCP.
_bg_tasks: set[asyncio.Task] = set()  # keep fire-and-forget refresh tasks referenced


async def _disputes_page(args: dict, offset: int) -> dict:
    return live_support.parse_tool_json(
        await mcp_client.call_tool("reconciliation_disputes", {**args, "offset": offset})
    )


async def _claimable_live(date_from: str | None, date_to: str | None) -> ClaimableRateResponse:
    base = {
        **live_support.date_args(date_from, date_to),
        "date_field": "reconciliation_at",
        "sort_by": "rate_diff",
        "limit": _CLAIMABLE_PAGE,
    }
    # Grand total (≥ noise floor) and the ≥threshold slice — one cheap call each.
    grand_r, thr_head = await asyncio.gather(
        mcp_client.call_tool("reconciliation_disputes",
                             {**base, "min_diff": 0.01, "limit": 1}),
        _disputes_page({**base, "min_diff": _CLAIMABLE_THRESHOLD}, 0),
    )
    grand = live_support.parse_tool_json(grand_r)
    grand_total = float(grand.get("claimable_total", 0) or 0)
    thr_total = float(thr_head.get("claimable_total", 0) or 0)
    matched = int(thr_head.get("total_matched", 0) or 0)

    # Paginate the whole ≥threshold population (concurrency-bounded) and split each
    # row by whether it carries an applied rate.
    thr_args = {**base, "min_diff": _CLAIMABLE_THRESHOLD}
    offsets = list(range(_CLAIMABLE_PAGE, matched, _CLAIMABLE_PAGE))  # page 0 already have
    sem = asyncio.Semaphore(_CLAIMABLE_CONCURRENCY)

    async def fetch(off: int) -> dict:
        async with sem:
            return await _disputes_page(thr_args, off)

    pages = [thr_head, *await asyncio.gather(*(fetch(o) for o in offsets))]

    claimable = 0.0
    excluded_no_applied = 0.0
    claim_count = 0
    seen = 0
    for pg in pages:
        for row in pg.get("rows", []) or []:
            seen += 1
            diff = float(row.get("rate_diff", 0) or 0)
            if float(row.get("applied_shipping_rate", 0) or 0) > 0:
                claimable += diff
                claim_count += 1
            else:
                excluded_no_applied += diff

    logger.info(
        "claimable: grand=%.0f thr>=%s=%.0f rows=%d/%d claimable=%.0f no_applied=%.0f below=%.0f",
        grand_total, _CLAIMABLE_THRESHOLD, thr_total, seen, matched,
        claimable, excluded_no_applied, grand_total - thr_total,
    )
    return ClaimableRateResponse(
        claimable_amount=round(claimable, 2),
        excluded_no_applied_rate=round(excluded_no_applied, 2),
        excluded_below_threshold=round(max(0.0, grand_total - thr_total), 2),
        count=claim_count,
        threshold=_CLAIMABLE_THRESHOLD,
        source="live",
        date_field="reconciliation_at",
    )


async def _refresh_claimable(key: tuple) -> None:
    """Recompute one window's claimable figure and store it. Deduped per window and
    serialised across windows (job semaphore). On failure the last good result is
    kept — never overwritten, never a spinner."""
    async with _claimable_inflight_guard(key) as acquired:
        if not acquired:  # another refresh for this window is already running
            return
        async with live_support.background_job_sem:  # one heavy enumeration at a time (global)
            try:
                resp = await _claimable_live(*key)
                _claimable_warm[key] = (time.monotonic(), resp)
                logger.info("claimable: warm refresh done for window=%s → %.0f", key, resp.claimable_amount)
            except Exception:  # noqa: BLE001 — keep last good, log, never fabricate
                logger.exception("claimable: warm refresh failed for %s; keeping last good", key)


class _claimable_inflight_guard:
    """Async context manager: registers `key` as in-flight; yields False if it was
    already registered (so the caller can bail without double-computing)."""

    def __init__(self, key: tuple):
        self.key = key

    async def __aenter__(self) -> bool:
        if self.key in _claimable_inflight:
            self.acquired = False
        else:
            _claimable_inflight.add(self.key)
            self.acquired = True
        return self.acquired

    async def __aexit__(self, *exc) -> None:
        if self.acquired:
            _claimable_inflight.discard(self.key)


# Reconciliation lags ~2 weeks (by reconciliation_at). A window whose END is within
# that lag is still reconciling → its claimable figure is real but low (most lines
# not yet reconciled), so the UI shows a maturity note instead of a bare ₹0.
_RECON_LAG_DAYS = 14


def _window_maturing(date_to: str | None) -> bool:
    try:
        end = date.fromisoformat(date_to) if date_to else date.today()
    except ValueError:
        end = date.today()
    return end > date.today() - timedelta(days=_RECON_LAG_DAYS)


def _spawn_refresh(key: tuple) -> None:
    task = asyncio.create_task(_refresh_claimable(key))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


async def _claimable_scheduler() -> None:
    """Background loop: keep the active (most-recently-requested) window hot by
    recomputing it every TTL. Started once at app startup."""
    logger.info("claimable: scheduler started (every %ds)", _CLAIMABLE_TTL_SECONDS)
    while True:
        if settings.mcp_connect_url:
            await _refresh_claimable(_claimable_primary_key)
        await asyncio.sleep(_CLAIMABLE_TTL_SECONDS)


def start_claimable_scheduler() -> None:
    """Launch the warm-refresh loop (idempotent-ish; called from app startup)."""
    _spawn_refresh_loop = asyncio.create_task(_claimable_scheduler())
    _bg_tasks.add(_spawn_refresh_loop)
    _spawn_refresh_loop.add_done_callback(_bg_tasks.discard)


async def get_claimable_rate(
    date_from: str | None = None, date_to: str | None = None
) -> ClaimableRateResponse:
    """Serve the claimable figure INSTANTLY from the warm store — the ~260s
    enumeration never runs inline. Behaviour:
      • warm & fresh for this window       → return it.
      • warm but stale                     → return it, flag recalculating, kick a bg refresh.
      • no result for this window yet       → return the primary window's last good
                                              figure (flag recalculating) + queue this
                                              window; if nothing warm at all → computing.
    """
    mat = _window_maturing(date_to)  # is the requested window still reconciling?
    if not settings.mcp_connect_url:
        return ClaimableRateResponse(source="mock", maturing=mat)

    global _claimable_primary_key
    key = (date_from, date_to)
    _claimable_primary_key = key  # scheduler keeps whatever users are viewing hot
    now = time.monotonic()

    hit = _claimable_warm.get(key)
    if hit is not None:
        ts, resp = hit
        if (now - ts) < _CLAIMABLE_TTL_SECONDS:
            return resp.model_copy(update={"maturing": mat})
        _spawn_refresh(key)  # stale → refresh in background, serve the warm figure now
        return resp.model_copy(update={"recalculating": True, "maturing": mat})

    # Nothing for this window yet — never block. Compute it in the background and
    # meanwhile serve the last good figure from any warm window (flagged), or a
    # "computing" placeholder if the very first run hasn't finished.
    _spawn_refresh(key)
    fallback = _claimable_warm.get((None, None)) or next(iter(_claimable_warm.values()), None)
    if fallback is not None:
        return fallback[1].model_copy(update={"recalculating": True, "maturing": mat})
    return ClaimableRateResponse(source="mock", computing=True, maturing=mat)


# --- Dispute Lines (Task P3) — the per-AWB list ops files with carriers ---------
# Same enumeration as the claimable KPI, but we RETAIN the rows. One enumeration
# per (window, min_diff) builds the full priced (applied_rate > 0), ≥min_diff,
# reconciliation_at-basis set; courier / invoice_no filtering, sorting and paging
# are then applied IN-MEMORY (instant) — so only the first view of a threshold is
# slow, and it's served with the same warm/computing pattern.
_LINES_MIN_DIFF_DEFAULT = 50.0
_LINES_PAGE_DEFAULT = 50
_LINES_TTL_SECONDS = 1800  # 30 min
# The page's DEFAULT view — pre-warmed on a schedule so opening it is instant.
# ₹100 floor (only material claims) on the LAST FULL CALENDAR MONTH (matured +
# STABLE — see matured_window). A stable window is essential: the scheduler
# pre-warms a fixed window, so a window that shifted daily would be cold every
# morning. This one only rolls at a month boundary.
_LINES_DEFAULT_MIN_DIFF = 100.0
_lines_cache: dict[tuple, tuple[float, "_LinesData"]] = {}
_lines_inflight: set[tuple] = set()
_lines_primary_key: tuple = (None, None, _LINES_MIN_DIFF_DEFAULT)


def matured_window() -> tuple[str, str]:
    """The default dispute/reconciliation window: the LAST FULL CALENDAR MONTH.
    STABLE — only changes at a month boundary, so the scheduler's pre-warm stays
    valid all day (a rolling window would be cold every morning). MATURED — a
    completed period whose reconciliation has settled. The FRONTEND computes the
    SAME window (identical formula), so its default request hits the pre-warm
    exactly. Single source of truth for 'the default range'."""
    first_of_this_month = date.today().replace(day=1)
    last_of_prev = first_of_this_month - timedelta(days=1)   # last day of previous month
    first_of_prev = last_of_prev.replace(day=1)              # first day of previous month
    return first_of_prev.isoformat(), last_of_prev.isoformat()


def _default_lines_keys() -> list[tuple]:
    """Keys the scheduler keeps hot: the ₹100 default view AND the heavier ₹50 view
    (a common toggle), both on the matured window."""
    mf, mt = matured_window()
    return [(mf, mt, _LINES_DEFAULT_MIN_DIFF), (mf, mt, _LINES_MIN_DIFF_DEFAULT)]


class _LinesData:
    """The full enumerated set for one (window, min_diff), cached and sliced."""

    def __init__(self, priced: list[DisputeLine], unpriced_total: int,
                 unpriced_by_courier: dict[str, int], couriers: list[str]):
        self.priced = priced  # sorted by rate_diff desc
        self.unpriced_total = unpriced_total
        self.unpriced_by_courier = unpriced_by_courier
        self.couriers = couriers


def _to_line(r: dict) -> DisputeLine:
    name = str(r.get("courier", "") or "")
    recon = str(r.get("recon_status", "") or "")
    od = r.get("order_date")
    return DisputeLine(
        awb=str(r.get("awb", "") or ""),
        invoice_no=(str(r.get("invoice_no")) if r.get("invoice_no") else None),
        courier=name,
        courier_slug=_norm(name),
        order_date=(str(od)[:10] if od else None),
        is_rto=bool(r.get("is_rto", False)),
        applied_weight_kg=round(float(r.get("applied_weight_kg", 0) or 0), 3),
        invoiced_weight_kg=round(float(r.get("invoiced_weight_kg", 0) or 0), 3),
        weight_diff_kg=round(float(r.get("weight_diff_kg", 0) or 0), 3),
        applied_rate=round(float(r.get("applied_shipping_rate", 0) or 0), 2),
        invoiced_rate=round(float(r.get("invoiced_shipping_rate", 0) or 0), 2),
        rate_diff=round(float(r.get("rate_diff", 0) or 0), 2),
        # Consistent with the project-wide relabel: the tool's "Disputed" is a
        # pending-reconciliation line, not a confirmed dispute.
        status=("Unreconciled" if recon == "Disputed" else recon),
    )


async def _build_lines(date_from: str | None, date_to: str | None, min_diff: float) -> "_LinesData":
    """Enumerate the whole ≥min_diff population once and split priced vs unpriced."""
    base = {
        **live_support.date_args(date_from, date_to),
        "date_field": "reconciliation_at",
        "sort_by": "rate_diff",
        "min_diff": min_diff,
        "limit": _CLAIMABLE_PAGE,
    }
    head = await _disputes_page(base, 0)
    matched = int(head.get("total_matched", 0) or 0)
    offsets = list(range(_CLAIMABLE_PAGE, matched, _CLAIMABLE_PAGE))
    sem = asyncio.Semaphore(_CLAIMABLE_CONCURRENCY)

    async def fetch(off: int) -> dict:
        async with sem:
            return await _disputes_page(base, off)

    pages = [head, *await asyncio.gather(*(fetch(o) for o in offsets))]

    priced: list[DisputeLine] = []
    unpriced_total = 0
    unpriced_by_courier: dict[str, int] = {}
    seen_couriers: set[str] = set()
    for pg in pages:
        for row in pg.get("rows", []) or []:
            name = str(row.get("courier", "") or "")
            seen_couriers.add(name)
            if float(row.get("applied_shipping_rate", 0) or 0) > 0:
                priced.append(_to_line(row))
            else:
                unpriced_total += 1
                unpriced_by_courier[name] = unpriced_by_courier.get(name, 0) + 1
    priced.sort(key=lambda x: x.rate_diff, reverse=True)
    couriers = sorted(n for n in seen_couriers if n)
    logger.info("dispute-lines: built window=%s..%s min_diff=%s → priced=%d unpriced=%d",
                date_from, date_to, min_diff, len(priced), unpriced_total)
    return _LinesData(priced, unpriced_total, unpriced_by_courier, couriers)


class _lines_inflight_guard:
    def __init__(self, key: tuple):
        self.key = key

    async def __aenter__(self) -> bool:
        if self.key in _lines_inflight:
            self.acquired = False
        else:
            _lines_inflight.add(self.key)
            self.acquired = True
        return self.acquired

    async def __aexit__(self, *exc) -> None:
        if self.acquired:
            _lines_inflight.discard(self.key)


async def _refresh_lines(key: tuple) -> None:
    async with _lines_inflight_guard(key) as acquired:
        if not acquired:
            return
        async with live_support.background_job_sem:  # global cap (shared with claimable/recovery)
            try:
                data = await _build_lines(*key)
                _lines_cache[key] = (time.monotonic(), data)
                # Each _LinesData holds thousands of rows → bound hard to avoid growth.
                live_support.prune_cache(_lines_cache, 8)
            except Exception:  # noqa: BLE001 — keep last good, never fabricate
                logger.exception("dispute-lines: build failed for %s; keeping last good", key)


def _spawn_lines_refresh(key: tuple) -> None:
    task = asyncio.create_task(_refresh_lines(key))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


async def _lines_scheduler() -> None:
    """Pre-warm the default views on startup and every 30 min so the page is always
    instant. Also keeps the last-viewed (window, min_diff) hot for quick re-visits."""
    logger.info("dispute-lines: scheduler started (every %ds)", _LINES_TTL_SECONDS)
    while True:
        if settings.mcp_connect_url:
            keys = _default_lines_keys()
            for key in keys:  # ₹100 default + ₹50 heavy, matured window
                await _refresh_lines(key)
            if _lines_primary_key not in keys:  # whatever the user is actually viewing
                await _refresh_lines(_lines_primary_key)
        await asyncio.sleep(_LINES_TTL_SECONDS)


def _fallback_lines_data() -> "_LinesData | None":
    """The freshest warm enumeration to show while a cold key builds — prefer a
    pre-warmed default, else the most recently built window."""
    for k in _default_lines_keys():
        h = _lines_cache.get(k)
        if h is not None:
            return h[1]
    if _lines_cache:
        return max(_lines_cache.values(), key=lambda v: v[0])[1]
    return None


def _serve_lines_source(key: tuple) -> tuple["_LinesData | None", bool, bool]:
    """Resolve what to serve for `key` WITHOUT ever enumerating inline:
      (data, computing, recalculating).
    Fresh warm → serve it. Stale → serve it + recalc (bg refresh). Cold → serve a
    fallback warm view + recalc (bg build), or computing if nothing is warm yet."""
    hit = _lines_cache.get(key)
    if hit is not None and (time.monotonic() - hit[0]) < _LINES_TTL_SECONDS:
        return hit[1], False, False
    _spawn_lines_refresh(key)  # build/refresh off the request path
    if hit is not None:
        return hit[1], False, True  # stale
    fb = _fallback_lines_data()
    if fb is not None:
        return fb, False, True  # cold → show a warm view while this one builds
    return None, True, False  # nothing warm anywhere yet


def start_lines_scheduler() -> None:
    task = asyncio.create_task(_lines_scheduler())
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


def _matches(line: DisputeLine, courier_slug: str | None, invoice_no: str | None) -> bool:
    if courier_slug:
        cs = courier_slug.strip()
        if cs and cs != line.courier and _norm(cs) != line.courier_slug:
            return False
    if invoice_no:
        needle = invoice_no.strip().lower()
        if needle and needle not in (line.invoice_no or "").lower():
            return False
    return True


def _filter_sort(data: "_LinesData", courier_slug: str | None,
                 invoice_no: str | None, sort_by: str) -> list[DisputeLine]:
    rows = [ln for ln in data.priced if _matches(ln, courier_slug, invoice_no)]
    key = (lambda x: abs(x.weight_diff_kg)) if sort_by == "weight_diff" else (lambda x: x.rate_diff)
    rows.sort(key=key, reverse=True)
    return rows


async def _ensure_lines(key: tuple, *, allow_build: bool) -> "_LinesData | None":
    """Return the cached set for `key`. If missing and allow_build, build inline
    (used by export — an explicit action). Otherwise return None (caller shows a
    computing/stale state and a background build is spawned)."""
    hit = _lines_cache.get(key)
    if hit is not None and (time.monotonic() - hit[0]) < _LINES_TTL_SECONDS:
        return hit[1]
    if allow_build:
        await _refresh_lines(key)
        got = _lines_cache.get(key)
        return got[1] if got else None
    return None


async def get_dispute_lines(
    date_from: str | None = None, date_to: str | None = None,
    min_diff: float = _LINES_MIN_DIFF_DEFAULT, sort_by: str = "rate_diff",
    courier_slug: str | None = None, invoice_no: str | None = None,
    page: int = 1, page_size: int = _LINES_PAGE_DEFAULT,
) -> DisputeLinesResponse:
    """Serve one page of dispute lines INSTANTLY from the warm enumeration.
    courier / invoice / sort / paging are applied in-memory; the ~min-of-compute
    enumeration (per window+min_diff) runs off the request path."""
    sort_by = "weight_diff" if sort_by == "weight_diff" else "rate_diff"
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    base = DisputeLinesResponse(
        page=page, page_size=page_size, min_diff=min_diff, sort_by=sort_by,
    )
    if not settings.mcp_connect_url:
        return base  # source=mock, empty

    global _lines_primary_key
    key = (date_from, date_to, min_diff)
    _lines_primary_key = key

    data, computing, recalculating = _serve_lines_source(key)
    if data is None:
        return base.model_copy(update={"source": "mock", "computing": computing})

    filtered = _filter_sort(data, courier_slug, invoice_no, sort_by)
    start = (page - 1) * page_size
    excluded = (data.unpriced_by_courier.get(courier_slug, 0)
                if courier_slug and courier_slug in data.unpriced_by_courier
                else data.unpriced_total)
    return base.model_copy(update={
        "lines": filtered[start:start + page_size],
        "total_matched": len(filtered),
        "claimable_amount": round(sum(ln.rate_diff for ln in filtered), 2),
        "excluded_no_applied_rate": excluded,
        "couriers": data.couriers,
        "source": "live",
        "recalculating": recalculating,
    })


async def get_dispute_lines_full(
    date_from: str | None = None, date_to: str | None = None,
    min_diff: float = _LINES_MIN_DIFF_DEFAULT, sort_by: str = "rate_diff",
    courier_slug: str | None = None, invoice_no: str | None = None,
) -> list[DisputeLine]:
    """The ENTIRE filtered set (no paging) for export. Builds inline if the page
    hasn't warmed it yet (export is an explicit action)."""
    if not settings.mcp_connect_url:
        return []
    key = (date_from, date_to, min_diff)
    data = await _ensure_lines(key, allow_build=True)
    if data is None:
        return []
    sort_by = "weight_diff" if sort_by == "weight_diff" else "rate_diff"
    return _filter_sort(data, courier_slug, invoice_no, sort_by)


# --- Invoice-grouped view — carriers reconcile by their bill (invoice_no). The
#     groups are built from the SAME priced lines as the flat view, so their totals
#     sum to the claimable figure EXACTLY (not from reconciliation_summary). --------
def _group_by_invoice(lines: list[DisputeLine]) -> list[DisputeInvoiceGroup]:
    acc: dict[str, dict] = {}
    for ln in lines:
        inv = ln.invoice_no or "(no invoice)"
        g = acc.get(inv)
        if g is None:
            g = acc[inv] = {"courier": ln.courier, "count": 0, "total": 0.0, "dmin": None, "dmax": None}
        g["count"] += 1
        g["total"] += ln.rate_diff  # per-line values are already 2-decimal
        if ln.order_date:
            g["dmin"] = ln.order_date if g["dmin"] is None else min(g["dmin"], ln.order_date)
            g["dmax"] = ln.order_date if g["dmax"] is None else max(g["dmax"], ln.order_date)
    groups = [
        DisputeInvoiceGroup(
            invoice_no=inv, courier=g["courier"], line_count=g["count"],
            rate_diff_total=round(g["total"], 2), date_from=g["dmin"], date_to=g["dmax"],
        )
        for inv, g in acc.items()
    ]
    groups.sort(key=lambda x: x.rate_diff_total, reverse=True)
    return groups


async def get_dispute_invoices(
    date_from: str | None = None, date_to: str | None = None,
    min_diff: float = _LINES_MIN_DIFF_DEFAULT,
    courier_slug: str | None = None, invoice_no: str | None = None,
    page: int = 1, page_size: int = 25,
) -> DisputeInvoicesResponse:
    """Invoice-grouped view served warm (same enumeration as the flat lines)."""
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    base = DisputeInvoicesResponse(page=page, page_size=page_size, min_diff=min_diff)
    if not settings.mcp_connect_url:
        return base

    global _lines_primary_key
    key = (date_from, date_to, min_diff)
    _lines_primary_key = key

    data, computing, recalculating = _serve_lines_source(key)
    if data is None:
        return base.model_copy(update={"source": "mock", "computing": computing})

    filtered = _filter_sort(data, courier_slug, invoice_no, "rate_diff")
    groups = _group_by_invoice(filtered)
    start = (page - 1) * page_size
    excluded = (data.unpriced_by_courier.get(courier_slug, 0)
                if courier_slug and courier_slug in data.unpriced_by_courier
                else data.unpriced_total)
    return base.model_copy(update={
        "invoices": groups[start:start + page_size],
        "total_matched": len(groups),
        # Σ over ALL invoices — equals the flat claimable by construction.
        "claimable_amount": round(sum(g.rate_diff_total for g in groups), 2),
        "excluded_no_applied_rate": excluded,
        "couriers": data.couriers,
        "source": "live",
        "recalculating": recalculating,
    })


async def get_dispute_invoices_full(
    date_from: str | None = None, date_to: str | None = None,
    min_diff: float = _LINES_MIN_DIFF_DEFAULT,
    courier_slug: str | None = None, invoice_no: str | None = None,
) -> list[DisputeInvoiceGroup]:
    """All invoice groups (no paging) for the invoice-summary export."""
    if not settings.mcp_connect_url:
        return []
    key = (date_from, date_to, min_diff)
    data = await _ensure_lines(key, allow_build=True)
    if data is None:
        return []
    return _group_by_invoice(_filter_sort(data, courier_slug, invoice_no, "rate_diff"))
