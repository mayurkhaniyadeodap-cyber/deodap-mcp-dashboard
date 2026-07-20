"""Weight analysis service — live via MCP with mock fallback.

KPIs: weight_reconciliation_summary (reconciliation LINES — ~2/order fwd+RTO —
driven by reconciliation_at; lags, so recent ranges return 0 → has_recon=False).
Only fwd_rate_diff is surfaced (rto/net count un-invoiced RTO legs as 0).

Scatter + slab histogram: list_orders is newest-first, so we STRIDE-sample — 5
pages of 500 at offsets spread across total_matched (0/20/40/60/80%) — instead
of just the most-recent 500. Histogram is over ALL usable points; the scatter
render is capped at 500. Per-AWB reconciliation cases do NOT exist → nothing
per-AWB is faked.
"""

from app.schemas.weight import WeightBucket, WeightPoint, WeightResponse, WeightSummary
from app.services import live_support, mcp_client
from app.services.courier_service import _name_and_code
from app.services.order_sampling import sample_orders

_cache = live_support.new_cache()
_SCATTER_CAP = 500  # rendered scatter points

# (label, upper_bound_kg) — last bucket is open-ended.
_SLABS = [("0–0.5", 0.5), ("0.5–1", 1.0), ("1–2", 2.0), ("2–5", 5.0), ("5+", float("inf"))]


def _empty_fallback() -> WeightResponse:
    """On MCP failure / blank token: return EMPTY data (source="mock") so the page
    renders its existing empty state — never a weight.json fixture / sample numbers.
    has_recon=False drives the "no reconciliation lines" empty card; empty scatter /
    histogram render empty charts."""
    return WeightResponse(
        scatter=[], histogram=[],
        summary=WeightSummary(
            reconciliation_lines=0, weight_overcharged=0, weight_diff_kg=0.0,
            fwd_rate_diff=0.0, reconciled=0, disputed=0, has_recon=False,
        ),
        source="unavailable",
    )


def _bucketize(weights: list[float]) -> list[WeightBucket]:
    counts = {label: 0 for label, _ in _SLABS}
    for w in weights:
        for label, ub in _SLABS:
            if w <= ub:
                counts[label] += 1
                break
    return [WeightBucket(bucket=label, count=counts[label]) for label, _ in _SLABS]


async def _fetch_live(date_from: str | None, date_to: str | None) -> WeightResponse:
    args = live_support.date_args(date_from, date_to)

    wr = live_support.parse_tool_json(
        await mcp_client.call_tool("weight_reconciliation_summary", args)
    )
    rows = int(wr.get("rows", 0) or 0)
    by_status = wr.get("by_status", {}) or {}
    summary = WeightSummary(
        reconciliation_lines=rows,
        weight_overcharged=int(wr.get("weight_overcharged", 0) or 0),
        weight_diff_kg=round(float(wr.get("weight_diff_kg", 0) or 0), 2),
        fwd_rate_diff=round(float(wr.get("fwd_rate_diff", 0) or 0), 2),
        reconciled=int(by_status.get("Reconciled", 0) or 0),
        disputed=int(by_status.get("Disputed", 0) or 0),
        has_recon=rows > 0,
    )

    # Deduped sample across the whole population (list_orders is newest-first).
    all_orders, total, is_full = await sample_orders(args)

    usable: list[WeightPoint] = []
    weights: list[float] = []
    missing_actual = 0
    for o in all_orders:
        actual = o.get("actual_weight_kg")
        charged = o.get("total_weight_kg")
        if actual is None:
            missing_actual += 1
        if actual is None or charged is None:
            continue
        usable.append(WeightPoint(
            actual=round(float(actual), 3),
            charged=round(float(charged), 3),
            courier=_name_and_code(str(o.get("courier_slug", "")))[0],
        ))
        weights.append(float(charged))

    # Histogram over ALL usable points; scatter render capped (strided so it stays spread).
    step = max(1, len(usable) // _SCATTER_CAP)
    scatter = usable[::step][:_SCATTER_CAP]

    sampled_rows = len(all_orders)
    return WeightResponse(
        scatter=scatter,
        histogram=_bucketize(weights),
        summary=summary,
        sample_size=len(usable),
        total_matched=total,
        is_full=is_full,
        sampled_rows=sampled_rows,
        missing_weight_count=missing_actual,
        missing_weight_pct=round(missing_actual / sampled_rows * 100, 1) if sampled_rows else 0.0,
        source="live",
        recon_date_field="reconciliation_at",
        sample_date_field="order_date",
    )


async def get_weight(date_from: str | None = None, date_to: str | None = None) -> WeightResponse:
    return await live_support.live_or_mock(
        cache=_cache, key=(date_from, date_to), label="weight",
        fetch=lambda: _fetch_live(date_from, date_to), mock=_empty_fallback,
    )
