"""Unit tests for pure helpers (no MCP, no I/O)."""

import json
from types import SimpleNamespace

from app.services import live_support
from app.services.zone_service import _canon_state


def test_rate_pct_matches_prior_inline_formula():
    assert live_support.rate_pct(3, 100) == 3.0
    assert live_support.rate_pct(0, 100) == 0.0
    assert live_support.rate_pct(5, 0) == 0.0  # div-by-zero guard
    assert live_support.rate_pct(1115, 21537) == 5.18


def test_date_args():
    assert live_support.date_args(None, None) == {}
    assert live_support.date_args("2026-06-01", None) == {"from": "2026-06-01"}
    assert live_support.date_args("2026-06-01", "2026-06-30") == {"from": "2026-06-01", "to": "2026-06-30"}


def test_parse_tool_json_structured():
    r = SimpleNamespace(content=[], structuredContent={"x": 1})
    assert live_support.parse_tool_json(r) == {"x": 1}


def test_parse_tool_json_text_block():
    block = SimpleNamespace(type="text", text=json.dumps({"y": 2}))
    r = SimpleNamespace(content=[block])
    assert live_support.parse_tool_json(r) == {"y": 2}


def test_scheduler_snapshot_cold_then_warm():
    import time

    warm: dict = {}
    key = (None, None)
    cold = live_support.scheduler_snapshot("x", 300, warm, key)
    assert cold["warm"] is False and cold["cache_age_seconds"] is None and cold["next_refresh_seconds"] is None

    warm[key] = (time.monotonic(), object())
    hot = live_support.scheduler_snapshot("x", 300, warm, key)
    assert hot["warm"] is True and hot["cache_age_seconds"] is not None
    assert 0 <= hot["next_refresh_seconds"] <= 300


def test_canon_state_aliases_and_garbage():
    assert _canon_state("Kerala") == "Kerala"
    assert _canon_state("KL") == "Kerala"
    assert _canon_state("Kerala,") == "Kerala"          # trailing comma stripped
    assert _canon_state("Maharastra") == "Maharashtra"  # Phase-1 extended alias
    assert _canon_state("DAMAN AND DIU") == "Dadra And Nagar Haveli And Daman And Diu"
    assert _canon_state("School") is None               # garbage → Unknown
    assert _canon_state("400001") is None               # pincode → Unknown


# --- B6: partial-month detection (mid-month start OR mid-month end) ---
def test_month_windows_partial_first_and_last():
    from app.services.date_windows import month_windows

    # Full calendar months (dates far in the past so `today` never clamps) → none partial.
    w = month_windows("2020-05-01", "2020-07-31")
    assert [p for *_rest, p in w] == [False, False, False]

    # Mid-month START → the FIRST month is partial (this is the B6 fix).
    w = {lbl: p for lbl, _s, _e, p in month_windows("2020-05-15", "2020-06-30")}
    assert w["May"] is True and w["Jun"] is False

    # Mid-month END → the LAST month is partial.
    w = {lbl: p for lbl, _s, _e, p in month_windows("2020-05-01", "2020-06-20")}
    assert w["May"] is False and w["Jun"] is True


# --- B8: reconciliation maturity flag (date-derived, never from MCP) ---
def test_window_maturing():
    from datetime import date, timedelta

    from app.services.date_windows import window_maturing

    assert window_maturing("2020-01-31") is False                 # long past → matured
    assert window_maturing(None) is True                          # no end → today → maturing
    assert window_maturing(date.today().isoformat()) is True
    assert window_maturing((date.today() - timedelta(days=30)).isoformat()) is False
    assert window_maturing((date.today() - timedelta(days=3)).isoformat()) is True


# --- B4 + B7: trend pivot builds an "Other" bucket and surfaces failed months ---
def test_pivot_other_bucket_and_failed_month():
    from app.services.trend_service import _MAX_COURIERS, _OTHER_LABEL, _pivot_by_month

    windows = [
        ("Jan", "2020-01-01", "2020-01-31", False),
        ("Feb", "2020-02-01", "2020-02-29", False),
        ("Mar", "2020-03-01", "2020-03-31", False),  # this month FAILS to load
    ]
    costs = {f"C{i}": float(10 * (10 - i)) for i in range(9)}  # 9 couriers C0..C8
    costs["(none)"] = 5.0                                       # + unassigned bucket
    month_costs = {"Jan": dict(costs), "Feb": dict(costs)}
    series, by_month = _pivot_by_month(windows, month_costs, {"Mar"})

    # Top-8 couriers + a single "Other"; "(none)" is never its own named series.
    assert series[-1] == _OTHER_LABEL
    assert len([s for s in series if s != _OTHER_LABEL]) == _MAX_COURIERS
    assert "(none)" not in series

    # Failed month is RETURNED as a gap (only the month key), never silently dropped.
    assert [r["month"] for r in by_month] == ["Jan", "Feb", "Mar"]
    mar = next(r for r in by_month if r["month"] == "Mar")
    assert set(mar.keys()) == {"month"}

    # Σ(top-8 + Other) == the month's FULL billing (nothing dropped → reconciles).
    jan = next(r for r in by_month if r["month"] == "Jan")
    assert round(sum(v for k, v in jan.items() if k != "month"), 2) == round(sum(costs.values()), 2)


def test_pivot_no_other_when_within_top_n():
    from app.services.trend_service import _OTHER_LABEL, _pivot_by_month

    windows = [("Jan", "2020-01-01", "2020-01-31", False)]
    series, by_month = _pivot_by_month(windows, {"Jan": {"A": 10.0, "B": 5.0}}, set())
    assert _OTHER_LABEL not in series and series == ["A", "B"]
    assert by_month[0] == {"month": "Jan", "A": 10.0, "B": 5.0}
