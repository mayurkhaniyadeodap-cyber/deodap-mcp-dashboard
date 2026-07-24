"""API/integration tests for the analytics endpoints, with MCP fully mocked.

These assert the endpoint → service → parse → response wiring works and that the
honest 'unavailable' fallback fires on MCP failure — WITHOUT asserting exact
business values (that would pin calculations we must not change)."""

import pytest

RANGE = {"from": "2026-06-01", "to": "2026-06-30"}


def test_sla_live(client, mock_mcp):
    mock_mcp()
    r = client.get("/api/sla-performance", params=RANGE)
    assert r.status_code == 200
    d = r.json()
    assert d["source"] == "live"
    assert d["on_time_pct"] == 80.0 and d["late"] == 20  # passthrough of the mocked field


def test_sla_unavailable_fallback(client, mock_mcp):
    mock_mcp(fail=True)
    r = client.get("/api/sla-performance", params={"from": "2026-07-01", "to": "2026-07-31"})
    assert r.status_code == 200
    assert r.json()["source"] == "unavailable"  # honest fallback, never fabricated


def test_zones_negative_avg_days_guarded(client, mock_mcp):
    """The mocked geo_performance has a Jharkhand area with avg_delivery_days=-293.1.
    The backend guard must ensure NO state reports a negative average."""
    mock_mcp()
    r = client.get("/api/zones", params=RANGE)
    assert r.status_code == 200
    states = r.json()["states"]
    assert states, "expected non-empty states"
    assert all(s["avg_delivery_days"] >= 0 for s in states), "a negative avg leaked through the guard"


@pytest.mark.parametrize("path", [
    "/api/cod",
    "/api/cod/intelligence",
    "/api/dashboard",
    "/api/discrepancies",
    "/api/trend",
    "/api/couriers",
    "/api/weight",
    "/api/bills",
])
def test_analytics_endpoints_ok(client, mock_mcp, path):
    mock_mcp()
    r = client.get(path, params=RANGE)
    assert r.status_code == 200, r.text


def test_scheduler_endpoint_admin_ok(client, mock_mcp):
    r = client.get("/api/_status/schedulers")
    assert r.status_code == 200
    names = {s["name"] for s in r.json()["schedulers"]}
    assert names == {"dashboard", "recovery", "savings", "claimable", "dispute-lines"}
