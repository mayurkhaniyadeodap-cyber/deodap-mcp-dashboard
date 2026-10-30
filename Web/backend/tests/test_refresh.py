"""Full live-data refresh ("Fetch Data Now" + automatic 30-minute refresh).

Covers: forced fresh reads through the MCP client (cache / single-flight / the
global concurrency cap preserved), the selected date range reaching every dataset,
cache replacement on success and last-good preservation on failure, duplicate-job
prevention between manual and scheduled runs, the scheduler cadence, and the API's
role gating + validation. Fully offline — the MCP is faked.
"""

import asyncio
import time
from datetime import UTC, datetime

import pytest

from app.api.deps import get_current_user
from app.auth.roles import Role
from app.core.config import settings
from app.main import app
from app.schemas.refresh import RefreshStatus
from app.services import (
    bills_service,
    cod_service,
    courier_service,
    dashboard_service,
    discrepancy_service,
    live_support,
    mcp_client,
    recovery_service,
    refresh_service,
    savings_service,
    sla_service,
    trend_service,
    weight_service,
    zone_service,
)
from tests.conftest import PAYLOADS, _FakeUser, fake_result

WIN = ("2026-09-01", "2026-09-30")
# savings_service prices orders with pincode_serviceability (not in the shared PAYLOADS).
_PINCODE = {"methods": [{"courier_slug": "dtdc", "rate_status": "success", "fwd_billed": 30.0}]}


@pytest.fixture(autouse=True)
def _reset_refresh_state():
    """Fresh job state + empty warm stores (conftest clears the 60s caches)."""
    refresh_service._status = RefreshStatus()
    refresh_service._task = None
    refresh_service._next_scheduled_at = None
    live_support.warm_failures.clear()
    for store in (discrepancy_service._claimable_warm, discrepancy_service._lines_cache,
                  discrepancy_service._recon_cache, savings_service._cache,
                  recovery_service._recovery_warm, bills_service._cache):
        store.clear()
    mcp_client._mcp_semaphores.clear()
    yield
    refresh_service._task = None


@pytest.fixture
def fake_mcp(monkeypatch):
    """Fake call_tool that records every (tool, args) and fails the tools in `failing`."""
    calls: list[tuple[str, dict]] = []
    failing: set[str] = set()
    table = {**PAYLOADS, "pincode_serviceability": _PINCODE}

    async def _call(name, arguments=None):
        calls.append((name, dict(arguments or {})))
        await asyncio.sleep(0)
        if name in failing or "*" in failing:
            raise RuntimeError(f"MCP down for {name} (test)")
        return fake_result(table[name])

    monkeypatch.setattr("app.services.mcp_client.call_tool", _call)
    return calls, failing


def _run_job(window=WIN, trigger="manual"):
    async def go():
        accepted, _ = refresh_service.start_refresh(
            trigger=trigger, date_from=window[0], date_to=window[1], triggered_by="Tester")
        await refresh_service.wait_for_current()
        return accepted

    return asyncio.run(go()), refresh_service.get_status()


# --- MCP client: forced fresh reads keep cache / single-flight / concurrency rules ----

def _install_execute(monkeypatch, *, delay=0.0, cap=6):
    monkeypatch.setattr(settings, "mcp_max_concurrency", cap)
    mcp_client._mcp_semaphores.clear()
    mcp_client.clear_tool_cache()
    real = {"n": 0, "cur": 0, "max": 0}

    async def _fake_execute(_operation):
        real["n"] += 1
        real["cur"] += 1
        real["max"] = max(real["max"], real["cur"])
        await asyncio.sleep(delay)
        real["cur"] -= 1
        return {"n": real["n"]}

    monkeypatch.setattr(mcp_client, "_execute", _fake_execute)
    return real


def test_fresh_results_skips_pre_refresh_cache_then_reuses_fresh_result(monkeypatch):
    real = _install_execute(monkeypatch)

    async def run():
        before = await mcp_client.call_tool("order_analytics", {"from": "a"})
        with mcp_client.fresh_results():
            fresh = await mcp_client.call_tool("order_analytics", {"from": "a"})  # cached one is too old
            again = await mcp_client.call_tool("order_analytics", {"from": "a"})  # fetched in this refresh
        after = await mcp_client.call_tool("order_analytics", {"from": "a"})  # normal TTL cache
        return before, fresh, again, after

    before, fresh, again, after = asyncio.run(run())
    assert real["n"] == 2
    assert before is not fresh
    assert fresh is again is after  # the fresh result also serves ordinary requests


def test_fresh_results_single_flight_collapses_identical_calls(monkeypatch):
    real = _install_execute(monkeypatch, delay=0.02)

    async def run():
        with mcp_client.fresh_results():
            return await asyncio.gather(*[mcp_client.call_tool("same") for _ in range(5)])

    results = asyncio.run(run())
    assert real["n"] == 1
    assert all(r is results[0] for r in results)


def test_fresh_results_waits_for_older_inflight_call_instead_of_duplicating(monkeypatch):
    real = _install_execute(monkeypatch, delay=0.05)

    async def run():
        old = asyncio.create_task(mcp_client.call_tool("slow"))  # started BEFORE the refresh
        await asyncio.sleep(0.01)
        with mcp_client.fresh_results():
            fresh = await mcp_client.call_tool("slow")
        return await old, fresh

    old, fresh = asyncio.run(run())
    assert real["n"] == 2  # the refresh made its own call…
    assert real["max"] == 1  # …but never two identical round-trips at once
    assert old is not fresh


def test_fresh_results_respects_global_concurrency_cap(monkeypatch):
    real = _install_execute(monkeypatch, delay=0.02, cap=2)

    async def run():
        with mcp_client.fresh_results():
            await asyncio.gather(*[mcp_client.call_tool(f"tool_{i}") for i in range(8)])

    asyncio.run(run())
    assert real["n"] == 8
    assert real["max"] == 2


# --- live_or_mock / couriers under a forced refresh ---------------------------------

def test_live_or_mock_outside_refresh_still_serves_fallback():
    async def boom():
        raise RuntimeError("down")

    out = asyncio.run(live_support.live_or_mock(
        cache={}, key=WIN, label="t", fetch=boom, mock=lambda: "unavailable"))
    assert out == "unavailable"


def test_live_or_mock_inside_refresh_raises_and_keeps_last_good():
    cache = {WIN: (time.monotonic(), "last-good")}

    async def boom():
        raise RuntimeError("down")

    async def run():
        with mcp_client.fresh_results():
            await live_support.live_or_mock(cache=cache, key=WIN, label="t", fetch=boom,
                                            mock=lambda: "unavailable")

    with pytest.raises(RuntimeError):
        asyncio.run(run())
    assert cache[WIN][1] == "last-good"


def test_couriers_inside_refresh_raises_and_keeps_last_good(fake_mcp):
    _calls, failing = fake_mcp
    failing.add("*")
    courier_service._cache[WIN] = (time.monotonic(), ["last-good"])

    async def run():
        with mcp_client.fresh_results():
            await courier_service.list_couriers(*WIN)

    with pytest.raises(RuntimeError):
        asyncio.run(run())
    assert courier_service._cache[WIN][1] == ["last-good"]


# --- The full refresh job --------------------------------------------------------

def test_refresh_success_fetches_every_module_for_the_selected_window(fake_mcp):
    calls, _ = fake_mcp
    dashboard_service._dashboard_primary_key = ("2025-01-01", "2025-01-31")  # what a user views

    accepted, st = _run_job()

    assert accepted
    assert st.state == "success" and not st.running
    assert st.total == len(st.datasets) == st.completed and st.failed == 0
    assert all(d.status == "success" and d.error is None for d in st.datasets)
    assert st.last_success_at is not None and st.last_attempt_at is not None
    assert (st.last_success_from, st.last_success_to) == WIN
    assert st.trigger == "manual" and st.triggered_by == "Tester"
    modules = {d.module for d in st.datasets}
    assert {"Dashboard", "Bills", "Courier Comparison", "Discrepancies", "COD", "Delivery Performance",
            "State Analysis", "Weight Analysis", "Trend Analysis", "Dispute Lines"} <= modules

    # The SELECTED window was fetched and stored for every window-keyed dataset.
    for cache in (cod_service._cache, cod_service._pending_cache, cod_service._intel_cache,
                  sla_service._cache, zone_service._cache, weight_service._cache,
                  trend_service._cache, discrepancy_service._cache, discrepancy_service._recon_cache,
                  courier_service._cache, dashboard_service._rate_cache, dashboard_service._billing_cache,
                  dashboard_service._dashboard_warm, discrepancy_service._claimable_warm,
                  savings_service._cache, recovery_service._recovery_warm):
        assert WIN in cache
    assert (*WIN, None, 1, 10, ()) in bills_service._cache  # Bills page-1 default view
    assert any(c[1].get("from") == WIN[0] and c[1].get("to") == WIN[1] for c in calls)
    assert any(c[0] == "sla_performance" and (c[1].get("from"), c[1].get("to")) == WIN for c in calls)

    # Dispute lines use their own matured window, and the status says so.
    lines = next(d for d in st.datasets if d.key == "dispute-lines")
    mf, mt = discrepancy_service.matured_window()
    assert (lines.date_from, lines.date_to) == (mf, mt)
    assert (mf, mt, discrepancy_service._LINES_DEFAULT_MIN_DIFF) in discrepancy_service._lines_cache

    # The refresh never changes what users are viewing (their selected dates).
    assert dashboard_service._dashboard_primary_key == ("2025-01-01", "2025-01-31")


def test_refresh_replaces_cache_entries_from_before_the_refresh(fake_mcp):
    cod_service._cache[WIN] = (time.monotonic(), "stale-but-within-ttl")
    _run_job()
    assert cod_service._cache[WIN][1] != "stale-but-within-ttl"
    assert cod_service._cache[WIN][1].source == "live"


def test_failed_refresh_keeps_last_good_data_and_last_success_time(fake_mcp):
    _calls, failing = fake_mcp
    _ok, first = _run_job()
    assert first.state == "success"
    good_cod = cod_service._cache[WIN]
    good_dash = dashboard_service._dashboard_warm[WIN]

    failing.add("*")
    _ok, st = _run_job()

    assert st.state == "failed" and st.failed == st.total
    assert all(d.status == "failed" and d.error for d in st.datasets)
    assert "previous data was kept" in (st.last_error or "")
    assert st.last_success_at == first.last_success_at  # last success preserved
    assert st.last_attempt_at > first.last_attempt_at
    # Nothing was replaced — no 'unavailable' or sample data written over live data.
    assert cod_service._cache[WIN] is good_cod
    assert dashboard_service._dashboard_warm[WIN] is good_dash
    assert asyncio.run(cod_service.get_cod(*WIN)).source == "live"


def test_partial_refresh_reports_only_the_failed_dataset(fake_mcp):
    _calls, failing = fake_mcp
    failing.add("sla_performance")
    _ok, st = _run_job()
    assert st.state == "partial"
    bad = [d for d in st.datasets if d.status == "failed"]
    assert [d.key for d in bad] == ["sla-performance"]
    assert "MCP down for sla_performance" in bad[0].error
    assert st.last_success_at is None  # a partial run is not a full success
    assert "Delivery SLA" in st.last_error


def test_refresh_error_message_never_contains_the_mcp_token(fake_mcp, monkeypatch):
    _calls, failing = fake_mcp
    failing.add("*")
    monkeypatch.setattr(settings, "mcp_token", "super-secret-token-xyz")

    async def leaky(*_a, **_k):
        raise RuntimeError("connect failed: https://x/mcp?mcp_token=super-secret-token-xyz")

    monkeypatch.setattr("app.services.mcp_client.call_tool", leaky)
    _ok, st = _run_job()
    assert all("super-secret-token-xyz" not in (d.error or "") for d in st.datasets)


def test_warm_dataset_joins_a_running_rebuild_instead_of_starting_another():
    key = WIN

    async def must_not_run(_key):
        raise AssertionError("a second identical rebuild was started")

    async def run():
        since = time.monotonic()
        dashboard_service._dashboard_inflight.add(key)

        async def finish_running_rebuild():
            await asyncio.sleep(0.05)
            dashboard_service._dashboard_warm[key] = (time.monotonic(), "fresh")
            dashboard_service._dashboard_inflight.discard(key)

        asyncio.create_task(finish_running_rebuild())
        await refresh_service._refresh_warm(
            "dashboard", dashboard_service, "_dashboard_warm", "_dashboard_inflight",
            "must_not_run", key, since)

    dashboard_service.must_not_run = must_not_run
    try:
        asyncio.run(run())
    finally:
        del dashboard_service.must_not_run
        dashboard_service._dashboard_inflight.discard(key)
    assert dashboard_service._dashboard_warm[key][1] == "fresh"


# --- Duplicate prevention: manual vs scheduled ------------------------------------

def test_second_manual_refresh_while_running_is_not_started(fake_mcp):
    async def go():
        first, _ = refresh_service.start_refresh(trigger="manual", date_from=WIN[0], date_to=WIN[1])
        second, st = refresh_service.start_refresh(trigger="manual", date_from=WIN[0], date_to=WIN[1])
        assert st.running and st.job_id == 1
        await refresh_service.wait_for_current()
        return first, second

    first, second = asyncio.run(go())
    assert first and not second
    assert refresh_service.get_status().job_id == 1


def test_scheduled_run_does_not_duplicate_a_running_manual_refresh_of_the_same_window(fake_mcp, monkeypatch):
    monkeypatch.setattr(refresh_service, "default_window", lambda: WIN)

    async def go():
        refresh_service.start_refresh(trigger="manual", date_from=WIN[0], date_to=WIN[1])
        return await refresh_service.run_scheduled_refresh()

    ran_own = asyncio.run(go())
    st = refresh_service.get_status()
    assert ran_own is False
    assert st.job_id == 1 and st.trigger == "manual" and st.state == "success"


def test_scheduled_run_waits_then_runs_when_the_running_refresh_is_another_window(fake_mcp, monkeypatch):
    monkeypatch.setattr(refresh_service, "default_window", lambda: WIN)

    async def go():
        refresh_service.start_refresh(trigger="manual", date_from="2026-01-01", date_to="2026-01-31")
        return await refresh_service.run_scheduled_refresh()

    ran_own = asyncio.run(go())
    st = refresh_service.get_status()
    assert ran_own is True
    assert st.job_id == 2 and st.trigger == "scheduled" and (st.date_from, st.date_to) == WIN


# --- Scheduler ----------------------------------------------------------------------

def test_default_window_is_last_30_days_on_the_ist_calendar_day(monkeypatch):
    # 20:00 UTC on 28 Oct is already 29 Oct in IST (UTC+05:30).
    monkeypatch.setattr(refresh_service, "_now", lambda: datetime(2026, 10, 28, 20, 0, tzinfo=UTC))
    assert refresh_service.default_window() == ("2026-09-30", "2026-10-29")


def test_automatic_refresh_defaults_to_every_30_minutes():
    from app.core.config import Settings

    assert Settings.model_fields["auto_refresh_interval_hours"].default == 0.5
    assert Settings.model_fields["auto_refresh_reuse_seconds"].default == 900.0
    # timeouts unchanged: 180s for background work, 30s for page requests
    assert Settings.model_fields["background_mcp_timeout_seconds"].default == 180.0
    assert Settings.model_fields["mcp_timeout_seconds"].default == 30.0


def test_scheduler_runs_after_initial_delay_then_every_interval(monkeypatch):
    monkeypatch.setattr(settings, "auto_refresh_initial_delay_seconds", 5.0)
    monkeypatch.setattr(settings, "auto_refresh_interval_hours", 0.5)
    runs: list[int] = []
    sleeps: list[float] = []

    async def fake_run():
        runs.append(1)
        return True

    real_sleep = asyncio.sleep

    async def fake_sleep(delay):
        sleeps.append(delay)
        if len(sleeps) == 3:
            raise asyncio.CancelledError
        await real_sleep(0)

    monkeypatch.setattr(refresh_service, "run_scheduled_refresh", fake_run)
    monkeypatch.setattr(refresh_service.asyncio, "sleep", fake_sleep)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(refresh_service._scheduler())
    assert len(runs) == 2
    assert sleeps[0] == pytest.approx(5.0, abs=0.5)
    # The fake sleep doesn't advance the clock, so the 2nd wait is the 5s initial delay
    # + the 30-min interval minus ~0 elapsed (Windows' coarse monotonic clock often
    # reads exactly 0 → 1805.0, which a 1800±5 bound rejected intermittently).
    assert sleeps[1] == pytest.approx(30 * 60 + 5, abs=1)
    assert refresh_service._next_scheduled_at is not None


def test_scheduler_disabled_starts_nothing(monkeypatch):
    monkeypatch.setattr(settings, "auto_refresh_enabled", False)
    before = set(refresh_service._bg_tasks)
    refresh_service.start_refresh_scheduler()  # no running loop needed when disabled
    assert refresh_service._bg_tasks == before
    assert refresh_service.get_status().next_scheduled_at is None


# --- API: role gating, validation, date range pass-through --------------------------

@pytest.fixture
def captured_start(monkeypatch):
    seen: dict = {}

    def fake_start(*, trigger, date_from, date_to, triggered_by=None):
        seen.update(trigger=trigger, date_from=date_from, date_to=date_to, triggered_by=triggered_by)
        return True, RefreshStatus(job_id=1, state="running", running=True, date_from=date_from,
                                   date_to=date_to, total=18)

    monkeypatch.setattr(refresh_service, "start_refresh", fake_start)
    return seen


def _as(role: Role):
    app.dependency_overrides[get_current_user] = lambda: _FakeUser(role)


def test_api_manual_refresh_uses_the_selected_window(client, captured_start):
    _as(Role.employee)
    r = client.post("/api/refresh", json={"from": "2026-09-01", "to": "2026-09-30"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accepted"] is True and "2026-09-01" in body["message"]
    assert captured_start == {"trigger": "manual", "date_from": "2026-09-01",
                              "date_to": "2026-09-30", "triggered_by": "Test Admin"}


def test_api_refresh_without_dates_uses_the_default_window(client, captured_start, monkeypatch):
    monkeypatch.setattr(refresh_service, "default_window", lambda: WIN)
    assert client.post("/api/refresh").status_code == 200
    assert (captured_start["date_from"], captured_start["date_to"]) == WIN


@pytest.mark.parametrize("body", [
    {"from": "2026-09-30", "to": "2026-09-01"},  # reversed
    {"from": "2026-09-01"},                      # half a range
    {"from": "01-09-2026", "to": "2026-09-30"},  # not ISO
])
def test_api_refresh_rejects_bad_ranges(client, captured_start, body):
    assert client.post("/api/refresh", json=body).status_code == 422
    assert captured_start == {}


@pytest.mark.parametrize("role", [Role.viewer, Role.finance, Role.operations])
def test_api_refresh_requires_admin_or_employee(client, captured_start, role):
    _as(role)
    assert client.post("/api/refresh", json={"from": WIN[0], "to": WIN[1]}).status_code == 403
    assert captured_start == {}
    assert client.get("/api/refresh/status").status_code == 200  # status is readable


def test_api_refresh_reports_already_running(client, monkeypatch):
    monkeypatch.setattr(refresh_service, "start_refresh", lambda **_k: (
        False, RefreshStatus(job_id=3, state="running", running=True, trigger="scheduled",
                             completed=4, total=18)))
    body = client.post("/api/refresh", json={"from": WIN[0], "to": WIN[1]}).json()
    assert body["accepted"] is False
    assert "already running" in body["message"] and "4/18" in body["message"]


def test_api_refresh_when_mcp_not_configured(client, captured_start, monkeypatch):
    monkeypatch.setattr(settings, "mcp_url", "")
    body = client.post("/api/refresh", json={"from": WIN[0], "to": WIN[1]}).json()
    assert body["accepted"] is False and "not configured" in body["message"]
    assert captured_start == {}


def test_api_refresh_status_shape(client):
    r = client.get("/api/refresh/status")
    assert r.status_code == 200
    body = r.json()
    for k in ("state", "running", "datasets", "last_attempt_at", "last_success_at",
              "next_scheduled_at", "auto_refresh_enabled", "interval_hours"):
        assert k in body


def test_api_refresh_start_is_rate_limited(client, captured_start):
    codes = [client.post("/api/refresh", json={"from": WIN[0], "to": WIN[1]}).status_code
             for _ in range(7)]
    assert codes[:6] == [200] * 6 and codes[6] == 429


def test_recovery_outage_keeps_last_good_series_instead_of_all_gaps(fake_mcp):
    """Every month failing is an outage: the warm series must not be replaced by an
    all-gap one (this also protects the existing 10-minute recovery scheduler)."""
    _calls, failing = fake_mcp
    _run_job()
    good = recovery_service._recovery_warm[WIN]
    failing.add("weight_reconciliation_summary")
    _ok, st = _run_job()
    rec = next(d for d in st.datasets if d.key == "trend-recovery")
    assert rec.status == "failed" and "every month" in rec.error
    assert recovery_service._recovery_warm[WIN] is good


def test_mcp_sdk_error_groups_are_unwrapped_to_a_readable_cause():
    nested = ExceptionGroup("unhandled errors in a TaskGroup",
                            [ExceptionGroup("unhandled errors in a TaskGroup", [TimeoutError()])])
    assert live_support.describe_error(nested).startswith("Ship MCP call timed out")
    assert live_support.describe_error(ExceptionGroup("g", [ValueError("bad json")])) == "ValueError: bad json"


def test_a_dataset_exceeding_its_time_budget_fails_without_blocking_the_rest(fake_mcp, monkeypatch):
    monkeypatch.setattr(settings, "refresh_dataset_timeout_seconds", 0.5)
    original = refresh_service._datasets

    async def hung(*_a, **_k):
        await asyncio.sleep(30)

    def with_hung_sla():
        return [refresh_service._Dataset(d.key, d.label, d.module, d.query_keys, refresh_service._live(hung))
                if d.key == "sla-performance" else d for d in original()]

    monkeypatch.setattr(refresh_service, "_datasets", with_hung_sla)
    _ok, st = _run_job()
    sla = next(d for d in st.datasets if d.key == "sla-performance")
    assert sla.status == "failed"
    assert sla.error.startswith("Timed out after")
    assert st.state == "partial"
    assert next(d for d in st.datasets if d.key == "cod").status == "success"


# --- Background per-call timeout (slow Ship MCP tools) ------------------------------

def test_call_timeout_overrides_the_request_timeout_only_inside_the_block(monkeypatch):
    monkeypatch.setattr(settings, "mcp_timeout_seconds", 30.0)
    assert mcp_client._effective_timeout() == 30.0
    with mcp_client.call_timeout(180.0):
        assert mcp_client._effective_timeout() == 180.0
    assert mcp_client._effective_timeout() == 30.0


def test_refresh_and_warm_rebuilds_use_the_background_timeout(monkeypatch):
    monkeypatch.setattr(settings, "mcp_timeout_seconds", 30.0)
    monkeypatch.setattr(settings, "background_mcp_timeout_seconds", 180.0)
    seen: set[float] = set()
    table = {**PAYLOADS, "pincode_serviceability": _PINCODE}

    async def _call(name, arguments=None):
        seen.add(mcp_client._effective_timeout())
        return fake_result(table[name])

    monkeypatch.setattr("app.services.mcp_client.call_tool", _call)
    _ok, st = _run_job()
    assert st.state == "success"
    assert seen == {180.0}  # every call of the refresh — light and warm datasets alike

    seen.clear()
    asyncio.run(dashboard_service._refresh_dashboard(("2026-08-01", "2026-08-31")))  # scheduler path
    assert seen == {180.0}
    seen.clear()
    asyncio.run(cod_service.get_cod("2026-08-01", "2026-08-31"))  # a page request
    assert seen == {30.0}


def test_forced_call_retries_once_when_the_joined_request_call_times_out(monkeypatch):
    import contextvars

    _install_execute(monkeypatch)
    attempts = {"n": 0}

    async def _fake_execute(_operation):
        attempts["n"] += 1
        await asyncio.sleep(0.02)
        if attempts["n"] == 1:
            raise TimeoutError  # the page request's 30s cap
        return {"ok": attempts["n"]}

    monkeypatch.setattr(mcp_client, "_execute", _fake_execute)

    async def run():
        with mcp_client.fresh_results():
            await asyncio.sleep(0)
            # a page request started DURING the refresh (no refresh context of its own)
            page = asyncio.create_task(mcp_client.call_tool("weight_reconciliation_summary"),
                                       context=contextvars.Context())
            await asyncio.sleep(0.005)
            forced = await mcp_client.call_tool("weight_reconciliation_summary")
        page_result = await asyncio.gather(page, return_exceptions=True)
        return forced, page_result[0]

    forced, page = asyncio.run(run())
    assert isinstance(page, TimeoutError)  # the page request still fails at its own cap
    assert forced == {"ok": 2}              # the refresh retried with its own call
    assert attempts["n"] == 2


# --- 30-minute cadence: no overlap, no repeated MCP work ----------------------------

class _FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def monotonic(self) -> float:
        return self.t

    def perf_counter(self) -> float:
        return self.t


def test_a_run_longer_than_30_minutes_never_triggers_a_back_to_back_run(monkeypatch):
    """A cold full refresh took ~22 min; if one ever exceeds the interval, the next
    run starts a full interval after it ends — never immediately, never overlapping."""
    clock = _FakeClock()
    monkeypatch.setattr(refresh_service, "time", clock)
    monkeypatch.setattr(settings, "auto_refresh_initial_delay_seconds", 0.0)
    monkeypatch.setattr(settings, "auto_refresh_interval_hours", 0.5)
    sleeps: list[float] = []
    real_sleep = asyncio.sleep

    async def slow_run():
        clock.t += 40 * 60  # this run took 40 minutes
        return True

    async def fake_sleep(delay):
        sleeps.append(delay)
        clock.t += delay
        if len(sleeps) == 3:
            raise asyncio.CancelledError
        await real_sleep(0)

    monkeypatch.setattr(refresh_service, "run_scheduled_refresh", slow_run)
    monkeypatch.setattr(refresh_service.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(refresh_service._scheduler())
    assert sleeps[0] == 0.0
    assert sleeps[1] == pytest.approx(30 * 60)  # full interval after the overrun, not 0
    assert sleeps[2] == pytest.approx(30 * 60)


def _seed_recent_warm(age_seconds: float) -> dict:
    """Pretend each slow dataset's own scheduler rebuilt the window `age_seconds` ago."""
    ts = time.monotonic() - age_seconds
    mf, mt = discrepancy_service.matured_window()
    seeded = {
        "dashboard": (dashboard_service._dashboard_warm, WIN),
        "claimable-rate": (discrepancy_service._claimable_warm, WIN),
        "savings-opportunity": (savings_service._cache, WIN),
        "trend-recovery": (recovery_service._recovery_warm, WIN),
        "dispute-lines": (discrepancy_service._lines_cache, (mf, mt, discrepancy_service._LINES_DEFAULT_MIN_DIFF)),
    }
    for key, (store, k) in seeded.items():
        store[k] = (ts, f"recent-{key}")
    return seeded


def _run_scheduled(monkeypatch):
    monkeypatch.setattr(refresh_service, "default_window", lambda: WIN)
    ran = asyncio.run(refresh_service.run_scheduled_refresh())
    return ran, refresh_service.get_status()


def test_scheduled_run_reuses_slow_datasets_their_schedulers_just_rebuilt(fake_mcp, monkeypatch):
    calls, _ = fake_mcp
    seeded = _seed_recent_warm(age_seconds=5 * 60)  # rebuilt 5 min ago (< 15 min)

    ran, st = _run_scheduled(monkeypatch)

    assert ran and st.state == "success" and st.trigger == "scheduled"
    for key, (store, k) in seeded.items():
        d = next(x for x in st.datasets if x.key == key)
        assert d.status == "success" and d.note and d.note.startswith("Reused")
        assert store[k][1] == f"recent-{key}"  # not rebuilt
    # the heavy enumerations were not repeated…
    assert not any(c[0] == "pincode_serviceability" for c in calls)  # savings sample
    assert not any(c[0] == "reconciliation_disputes" and c[1].get("date_field") == "reconciliation_at"
                   for c in calls)  # claimable + dispute-lines enumerations
    # …but the light datasets were still fetched fresh for the default window
    assert next(x for x in st.datasets if x.key == "cod").note is None
    assert any(c[0] == "sla_performance" and (c[1].get("from"), c[1].get("to")) == WIN for c in calls)


def test_scheduled_run_rebuilds_slow_datasets_older_than_the_reuse_window(fake_mcp, monkeypatch):
    seeded = _seed_recent_warm(age_seconds=20 * 60)  # 20 min old (> 15 min)
    _ran, st = _run_scheduled(monkeypatch)
    assert st.state == "success"
    for key, (store, k) in seeded.items():
        assert next(x for x in st.datasets if x.key == key).note is None
        assert store[k][1] != f"recent-{key}"  # rebuilt


def test_manual_refresh_never_reuses_and_always_fetches_fresh(fake_mcp):
    seeded = _seed_recent_warm(age_seconds=60)  # rebuilt just 1 min ago
    _ok, st = _run_job(trigger="manual")
    assert st.state == "success"
    for key, (store, k) in seeded.items():
        assert next(x for x in st.datasets if x.key == key).note is None
        assert store[k][1] != f"recent-{key}"


def test_scheduled_run_is_skipped_right_after_a_full_refresh_of_the_same_window(fake_mcp, monkeypatch):
    calls, _ = fake_mcp
    _run_job(window=WIN, trigger="manual")  # e.g. someone clicked Fetch Data Now
    before = len(calls)
    ran, st = _run_scheduled(monkeypatch)
    assert ran is False
    assert st.job_id == 1 and st.trigger == "manual"
    assert len(calls) == before  # zero MCP requests


def test_scheduled_run_still_runs_after_a_partial_or_old_refresh(fake_mcp, monkeypatch):
    _calls, failing = fake_mcp
    failing.add("sla_performance")
    _run_job(window=WIN, trigger="manual")
    failing.clear()
    ran, st = _run_scheduled(monkeypatch)  # last run was only partial → run again
    assert ran is True and st.job_id == 2 and st.state == "success"

    refresh_service._status.finished_at = refresh_service._now().replace(year=2025)  # long ago
    ran, st = _run_scheduled(monkeypatch)
    assert ran is True and st.job_id == 3


# --- Date selection vs Fetch Data Now: same filters, and the refresh really refetches ---

class _FakeSession:
    """Stands in for the MCP network session only — everything above it (tool cache,
    single-flight, concurrency limit, service caches) is the real code path."""

    def __init__(self, log: list) -> None:
        self.log = log

    async def call_tool(self, name, arguments):
        self.log.append((name, dict(arguments)))
        return fake_result({**PAYLOADS, "pincode_serviceability": _PINCODE}[name])


@pytest.fixture
def source_log(monkeypatch):
    """Every request that reaches the (fake) Ship MCP server, in order."""
    log: list[tuple[str, dict]] = []

    async def _execute(operation):
        return await operation(_FakeSession(log))

    monkeypatch.setattr(mcp_client, "_execute", _execute)
    mcp_client._mcp_semaphores.clear()
    mcp_client.clear_tool_cache()
    return log


def _key(call):
    return call[0], tuple(sorted(call[1].items()))


def test_date_selection_and_fetch_data_now_use_identical_filters_and_refresh_refetches(
        client, source_log, caplog):
    caplog.set_level("INFO", logger="datafetch")
    url = f"/api/cod?from={WIN[0]}&to={WIN[1]}"

    # 1) Selecting the range → page GET → live MCP, with the selected dates.
    first = client.get(url).json()
    page_calls = list(source_log)
    assert first["source"] == "live" and page_calls
    # The selected range itself, slices INSIDE it (weekly trend), and — for the
    # period-over-period KPI deltas — the previous window derived from it. Nothing else.
    _cur, prev = dashboard_service._delta_windows(*WIN)
    ranges = {(c[1].get("from"), c[1].get("to")) for c in page_calls}
    assert WIN in ranges
    for r in ranges:
        assert (WIN[0] <= r[0] <= r[1] <= WIN[1]) or r == (prev["from"], prev["to"]), r

    # 2) Selecting it again within 60s → served from cache, no new source request.
    assert client.get(url).json() == first
    assert len(source_log) == len(page_calls)

    # 3) Fetch Data Now for the SAME range → the same queries go to the source again,
    #    even though the cache still holds them.
    _ok, st = _run_job(window=WIN)
    refresh_calls = source_log[len(page_calls):]
    assert {_key(c) for c in page_calls} <= {_key(c) for c in refresh_calls}
    assert st.mcp_round_trips == len(refresh_calls) > 0
    assert st.mcp_requests == st.mcp_round_trips + st.mcp_deduplicated

    # 4) The page now reads what the refresh fetched — no extra source request; identical
    #    numbers are expected because the (fake) source data did not change.
    before = len(source_log)
    assert client.get(url).json() == first
    assert len(source_log) == before

    lines = [r.getMessage() for r in caplog.records if r.name == "datafetch"]
    cod = [m for m in lines if m.startswith("dataset=cod ")]
    assert f"range={WIN[0]}..{WIN[1]} source=live-mcp" in cod[0] and "mode=page" in cod[0]
    assert "source=cache" in cod[1] and "fetched_at=" in cod[1]
    assert any("source=live-mcp" in m and "mode=refresh" in m for m in cod[2:])
    assert "source=cache" in cod[-1] and "mode=page" in cod[-1]
    assert any(m.startswith("refresh #1 finished") and f"mcp_round_trips={st.mcp_round_trips}" in m
               for m in lines)


def test_different_date_ranges_never_share_cached_results(client, source_log):
    a = client.get(f"/api/sla-performance?from={WIN[0]}&to={WIN[1]}")
    n = len(source_log)
    b = client.get("/api/sla-performance?from=2026-08-01&to=2026-08-31")
    assert a.status_code == b.status_code == 200
    new = source_log[n:]
    assert new and all((c[1].get("from"), c[1].get("to")) == ("2026-08-01", "2026-08-31") for c in new)


def test_warm_dataset_logs_show_range_source_and_fetch_time(caplog):
    caplog.set_level("INFO", logger="datafetch")
    dashboard_service._dashboard_warm[WIN] = (time.monotonic() - 42, "warm")
    assert asyncio.run(dashboard_service.get_dashboard(*WIN)) == "warm"
    msg = next(r.getMessage() for r in caplog.records if r.name == "datafetch")
    assert f"dataset=dashboard range={WIN[0]}..{WIN[1]} source=warm-cache" in msg
    assert "fetched_at=" in msg and "age=4" in msg and "mode=page" in msg
