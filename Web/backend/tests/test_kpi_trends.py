"""KPI sparkline series (GET /api/dashboard/kpi-trends).

The range is split into ≤7 equal periods and each KPI is computed per period with the
same MCP tools as its headline value. A metric is returned only when EVERY period
loaded (no partial lines), and an MCP outage yields no series at all (never invented).
Fully offline — the MCP is faked.
"""

import asyncio

import pytest

from app.services import dashboard_service
from tests.conftest import PAYLOADS, fake_result


@pytest.fixture(autouse=True)
def _clear_trends_cache():
    dashboard_service._trends_cache.clear()
    yield
    dashboard_service._trends_cache.clear()


@pytest.fixture
def fake_mcp(monkeypatch):
    calls: list[tuple[str, dict]] = []
    failing: dict[str, str | None] = {}  # tool -> only fail for this "from" (None = always)

    async def _call(name, arguments=None):
        args = dict(arguments or {})
        calls.append((name, args))
        await asyncio.sleep(0)
        if name in failing and failing[name] in (None, args.get("from")):
            raise RuntimeError(f"MCP down for {name} (test)")
        return fake_result(PAYLOADS[name])

    monkeypatch.setattr("app.services.mcp_client.call_tool", _call)
    return calls, failing


def test_buckets_are_contiguous_equal_and_capped():
    b = dashboard_service.trend_buckets("2026-09-01", "2026-09-30")
    assert len(b) == 7
    assert b[0][0] == "2026-09-01" and b[-1][1] == "2026-09-30"
    # contiguous: each period starts the day after the previous one ends
    from datetime import date, timedelta
    for (_, end), (start, _) in zip(b, b[1:]):
        assert date.fromisoformat(start) == date.fromisoformat(end) + timedelta(days=1)
    assert dashboard_service.trend_buckets("2026-09-01", "2026-09-03") == [
        ("2026-09-01", "2026-09-01"), ("2026-09-02", "2026-09-02"), ("2026-09-03", "2026-09-03"),
    ]


def test_single_day_or_no_range_has_no_periods():
    assert dashboard_service.trend_buckets("2026-09-05", "2026-09-05") == []
    assert dashboard_service.trend_buckets(None, None) == []


def test_series_use_the_same_tools_per_period(fake_mcp):
    calls, _ = fake_mcp
    resp = asyncio.run(dashboard_service.get_kpi_trends("2026-09-01", "2026-09-07"))
    assert resp.source == "live"
    assert len(resp.buckets) == 7
    assert set(resp.series) == {"total_billing", "total_shipments", "average_cost", "total_cod", "pending_recon"}
    assert all(len(v) == 7 for v in resp.series.values())
    # every period queried each KPI's own tool with that period's dates
    froms = {a.get("from") for t, a in calls if t == "shipping_cost_summary"}
    assert froms == {b.date_from for b in resp.buckets}
    assert {t for t, _ in calls} == {"order_analytics", "shipping_cost_summary", "cod_remittance_aging", "reconciliation_summary"}


def test_a_failed_period_drops_only_that_metric(fake_mcp):
    _, failing = fake_mcp
    failing["cod_remittance_aging"] = "2026-09-03"  # one period of one tool fails
    resp = asyncio.run(dashboard_service.get_kpi_trends("2026-09-01", "2026-09-07"))
    assert "total_cod" not in resp.series  # no partial line
    assert "total_billing" in resp.series and "pending_recon" in resp.series


def test_outage_returns_no_series(fake_mcp):
    _, failing = fake_mcp
    for tool in ("order_analytics", "shipping_cost_summary", "cod_remittance_aging", "reconciliation_summary"):
        failing[tool] = None
    resp = asyncio.run(dashboard_service.get_kpi_trends("2026-09-01", "2026-09-07"))
    assert resp.source == "unavailable"
    assert resp.series == {}


def test_result_is_cached_for_the_range(fake_mcp):
    calls, _ = fake_mcp
    asyncio.run(dashboard_service.get_kpi_trends("2026-09-01", "2026-09-07"))
    n = len(calls)
    asyncio.run(dashboard_service.get_kpi_trends("2026-09-01", "2026-09-07"))
    assert len(calls) == n  # second request served from the 15-minute cache


def test_endpoint_serves_series(client, fake_mcp):
    r = client.get("/api/dashboard/kpi-trends", params={"from": "2026-09-01", "to": "2026-09-07"})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "live" and len(body["buckets"]) == 7
    assert len(body["series"]["total_shipments"]) == 7
