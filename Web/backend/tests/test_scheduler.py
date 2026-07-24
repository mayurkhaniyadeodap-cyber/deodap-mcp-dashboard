"""Scheduler telemetry + failure-safety tests."""

import asyncio

from app.services import recovery_service, status_service


def test_get_scheduler_status_lists_all_five():
    r = status_service.get_scheduler_status()
    names = {s.name for s in r.schedulers}
    assert names == {"dashboard", "recovery", "savings", "claimable", "dispute-lines"}
    assert all(s.cadence_seconds > 0 for s in r.schedulers)


def test_scheduler_refresh_swallows_failures(monkeypatch):
    """A failing compute inside a scheduler refresh must be logged and swallowed —
    never propagated (schedulers must not crash the loop)."""
    async def _boom(*a, **k):
        raise RuntimeError("compute failed (test)")

    monkeypatch.setattr(recovery_service, "_fetch_live", _boom)
    # Must NOT raise despite _fetch_live blowing up.
    asyncio.run(recovery_service._refresh_recovery((None, None)))
