"""Savings-opportunity service — SLOW, own 30-min cache, separate endpoint.

For a capped sample of AWBs, price every serviceable courier at the order's
pincode + weight + payment_type (pincode_serviceability, restricted to the
order's warehouse → fewer methods + more correct), take the cheapest fwd_billed
(grossed +18% GST to compare with the all-in applied_courier_rate), and report
the per-AWB saving vs the courier actually used. Cheapest ≠ better overall, so we
attach the cheapest courier's RTO%. pincode_serviceability is ~9s p95, so this is
sampled (25), concurrency-limited (6), and cached 30 min. Failed prices are skipped.
"""

import asyncio
import logging
import time

from app.schemas.savings import SavingRow, SavingsResponse
from app.services import live_support, mcp_client
from app.services.courier_service import _name_and_code

logger = logging.getLogger("live")

# Sample size is a deterministic top-N (see _fetch_live). 40 @ concurrency 10 keeps
# the cold build (~45s, own skeleton, cached 30 min) close to the old 25-sample cost
# while giving a steadier estimate. (60 was ~100s — too slow for an inline load.)
_SAMPLE = 40
_CONCURRENCY = 10
_GST = 1.18
_TTL_SECONDS = 1800  # 30 min
_cache: dict[tuple, tuple[float, SavingsResponse]] = {}

_NOTE = "Theoretical maximum — ignores SLA, capacity and routing rules."


def _mock() -> SavingsResponse:
    # Honest "unavailable" (empty) — never fabricated savings.
    return SavingsResponse(rows=[], sampled=0, skipped=0, total_saving=0.0, source="unavailable", note=_NOTE)


async def _rto_by_slug(args: dict) -> dict[str, float]:
    """Cheapest courier's RTO% column source (rto_analysis ÷ order_analytics orders)."""
    rto_r, oa_r = await asyncio.gather(
        mcp_client.call_tool("rto_analysis", args),
        mcp_client.call_tool("order_analytics", {**args, "group_by": "courier"}),
    )
    rto = live_support.parse_tool_json(rto_r)
    oa = live_support.parse_tool_json(oa_r)
    orders = {str(g.get("group")): int(g.get("orders", 0) or 0) for g in oa.get("breakdown", []) or []}
    counts = {str(c.get("value")): int(c.get("count", 0) or 0) for c in rto.get("by_courier", []) or []}
    return {slug: round(counts.get(slug, 0) / o * 100, 2) if o else 0.0 for slug, o in orders.items()}


async def _fetch_live(date_from: str | None, date_to: str | None) -> SavingsResponse:
    args = live_support.date_args(date_from, date_to)
    rto_pct = await _rto_by_slug(args)

    # Stride-sample AWBs across the whole population (list_orders is newest-first,
    # so a single page is all one courier/region — biased). 5 spread pages → a
    # diverse pool of couriers + destinations.
    first = live_support.parse_tool_json(
        await mcp_client.call_tool("list_orders", {**args, "limit": 40, "offset": 0})
    )
    total = int(first.get("total_matched", 0) or 0)
    offsets = sorted({min(max(total - 1, 0), int(total * f)) for f in (0.2, 0.4, 0.6, 0.8)})
    pages = await asyncio.gather(
        *[mcp_client.call_tool("list_orders", {**args, "limit": 40, "offset": off}) for off in offsets],
        return_exceptions=True,
    )
    all_orders = list(first.get("orders", []) or [])
    for p in pages:
        if not isinstance(p, Exception):
            all_orders += live_support.parse_tool_json(p).get("orders", []) or []
    eligible = [
        o for o in all_orders
        if o.get("awb") and o.get("pincode") and o.get("warehouse_id") and (o.get("applied_courier_rate") or 0) > 0
    ]
    # DETERMINISTIC sample: the N eligible orders with the lowest AWB. AWB is a
    # stable per-shipment key, so the SAME shipments are priced on every rebuild —
    # the KPI can't flicker on refresh with identical inputs. (The old stride
    # `eligible[::step]` swapped its picks whenever the population shifted slightly.)
    # De-dupe by AWB first so a shipment appearing on two pages isn't double-weighted.
    by_awb = {str(o["awb"]): o for o in eligible}
    pool = [by_awb[a] for a in sorted(by_awb)[:_SAMPLE]]

    sem = asyncio.Semaphore(_CONCURRENCY)

    async def price(o: dict) -> SavingRow | None:
        async with sem:
            try:
                d = live_support.parse_tool_json(await mcp_client.call_tool("pincode_serviceability", {
                    "pincode": str(o["pincode"]),
                    "weight_kg": float(o.get("total_weight_kg") or 0.5),
                    "payment_type": o.get("payment_type") or "Prepaid",
                    "warehouse_id": int(o["warehouse_id"]),
                }))
            except Exception:  # noqa: BLE001 — skip AWBs whose pricing fails
                return None
            priced = [
                m for m in d.get("methods", []) or []
                if m.get("rate_status") == "success" and (m.get("fwd_billed") or 0) > 0
            ]
            if not priced:
                return None
            cheapest = min(priced, key=lambda m: float(m["fwd_billed"]))
            cheapest_slug = str(cheapest.get("courier_slug", ""))
            applied = round(float(o["applied_courier_rate"]), 2)
            cheapest_rate = round(float(cheapest["fwd_billed"]) * _GST, 2)
            return SavingRow(
                awb=str(o["awb"]),
                courier_used=_name_and_code(str(o.get("courier_slug", "")))[0],
                applied=applied,
                cheapest_courier=_name_and_code(cheapest_slug)[0],
                cheapest_rate=cheapest_rate,
                saving=round(applied - cheapest_rate, 2),
                cheapest_rto_pct=rto_pct.get(cheapest_slug, 0.0),
            )

    results = await asyncio.gather(*[price(o) for o in pool])
    rows = [r for r in results if r is not None]
    rows.sort(key=lambda r: r.saving, reverse=True)
    skipped = len(pool) - len(rows)
    total_saving = round(sum(r.saving for r in rows if r.saving > 0), 2)
    logger.info("savings: sampled=%d skipped=%d total_saving=%.2f", len(rows), skipped, total_saving)
    return SavingsResponse(
        rows=rows, sampled=len(rows), skipped=skipped, total_saving=total_saving, source="live", note=_NOTE
    )


# --- Background warm cache -----------------------------------------------------
# The build is SLOW (~1.4 min: 40× pincode_serviceability). A scheduler refreshes it
# every 30 min so requests serve the warm result instantly. Serve rules: fresh →
# serve; stale → serve last-good AND rebuild in the background (never blocks 1.4 min);
# cold (a window never built) → build once, then it's warm. Response is identical.
_SAVINGS_CACHE_MAX = 16  # cap distinct windows kept warm (memory bound)
_savings_primary_key: tuple = (None, None)  # last-viewed window the scheduler keeps hot
_savings_inflight: set[tuple] = set()        # windows currently being rebuilt (dedupe)
_savings_bg: set[asyncio.Task] = set()


async def _refresh_savings(key: tuple) -> None:
    """Rebuild one window and store it warm. De-duplicated per key (a burst of stale
    requests triggers ONE ~1.4-min rebuild) and concurrency-capped by the shared
    background-job semaphore so it never contends with user requests. On failure the
    last-good warm value is kept."""
    async with live_support.inflight_guard(_savings_inflight, key) as acquired:
        if not acquired:  # a rebuild for this window is already running
            return
        async with live_support.background_job_sem:
            try:
                result = await _fetch_live(*key)
                _cache[key] = (time.monotonic(), result)
                live_support.prune_cache(_cache, _SAVINGS_CACHE_MAX)
                logger.info("savings: warm refresh done for %s", key)
            except Exception:  # noqa: BLE001 — keep last good, never fabricate
                logger.exception("savings: warm refresh failed for %s; keeping last good", key)


def _spawn_savings_refresh(key: tuple) -> None:
    task = asyncio.create_task(_refresh_savings(key))
    _savings_bg.add(task)
    task.add_done_callback(_savings_bg.discard)


async def _savings_scheduler() -> None:
    logger.info("savings: warm scheduler started (every 1800s)")
    while True:
        if live_support.settings.mcp_connect_url:
            await _refresh_savings(_savings_primary_key)
        await asyncio.sleep(1800)  # 30 minutes


def start_savings_scheduler() -> None:
    """Launch the 30-min warm-refresh loop (called from app startup)."""
    task = asyncio.create_task(_savings_scheduler())
    _savings_bg.add(task)
    task.add_done_callback(_savings_bg.discard)


async def get_savings_opportunity(
    date_from: str | None = None, date_to: str | None = None
) -> SavingsResponse:
    global _savings_primary_key
    key = (date_from, date_to)
    _savings_primary_key = key  # scheduler keeps whatever users are viewing hot
    now = time.monotonic()
    cached = _cache.get(key)
    if cached is not None:
        ts, resp = cached
        if (now - ts) < _TTL_SECONDS:
            return resp  # fresh — instant
        _spawn_savings_refresh(key)  # stale → serve last-good now, rebuild in background
        return resp
    if not live_support.settings.mcp_connect_url:
        logger.warning("savings: Ship MCP not configured — returning empty sample.")
        return _mock()
    try:
        # Cold window (never built) → build once, then the scheduler keeps it warm.
        result = await _fetch_live(date_from, date_to)
        _cache[key] = (now, result)
        live_support.prune_cache(_cache, _SAVINGS_CACHE_MAX)
        return result
    except Exception as exc:  # noqa: BLE001 — never break the page
        logger.warning("savings: Ship MCP unavailable (%s) — returning empty sample.", exc)
        return _mock()
