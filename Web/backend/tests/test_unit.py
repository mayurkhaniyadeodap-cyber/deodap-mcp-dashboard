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
