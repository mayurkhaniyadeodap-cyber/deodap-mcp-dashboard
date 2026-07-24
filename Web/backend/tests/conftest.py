"""Shared pytest fixtures. Tests mock the MCP entirely — no live server, no real
tool calls — so they are deterministic and offline. NOTHING in app code is changed;
tests only override the auth dependency and monkeypatch mcp_client.call_tool."""

import importlib
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.auth.roles import Role
from app.main import app


class _FakeUser:
    def __init__(self, role: Role = Role.admin) -> None:
        self.id = 1
        self.email = "test@deodap.in"
        self.name = "Test Admin"
        self.role = role


@pytest.fixture
def client():
    """TestClient with auth bypassed. NOT used as a context manager, so FastAPI's
    lifespan (startup schedulers + real MCP) never runs — tests stay offline."""
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    c = TestClient(app)
    try:
        yield c
    finally:
        app.dependency_overrides.clear()


def fake_result(payload: dict) -> SimpleNamespace:
    """Mimic an MCP CallToolResult that live_support.parse_tool_json can read
    (it falls back to .structuredContent when there is no text content block)."""
    return SimpleNamespace(content=[], structuredContent=payload)


# Rich canned payloads — enough fields for every service mapper to run without error.
PAYLOADS: dict[str, dict] = {
    "sla_performance": {
        "delivered": 100, "on_time": 80, "late": 20, "on_time_pct": 80.0,
        "avg_delay_days": 2.0, "overdue_in_transit": 5, "date_field": "order_date",
    },
    "shipping_cost_summary": {
        "totals": {"orders": 100, "fwd_cost": 1000.0, "rto_cost": 100.0, "total_cost": 1100.0},
        "breakdown": [
            {"group": "blue_dart", "orders": 60, "fwd_cost": 600.0, "rto_cost": 60.0, "total_cost": 660.0, "avg_cost": 11.0},
            {"group": "COD", "orders": 30, "fwd_cost": 300.0, "rto_cost": 40.0, "total_cost": 340.0, "avg_cost": 11.3},
            {"group": "Prepaid", "orders": 70, "fwd_cost": 700.0, "rto_cost": 60.0, "total_cost": 760.0, "avg_cost": 10.9},
            {"group": "Maharashtra", "orders": 100, "fwd_cost": 1000.0, "rto_cost": 100.0, "total_cost": 1100.0},
        ],
    },
    "order_analytics": {
        "totals": {"orders": 100, "order_value": 50000.0, "cod_value": 8000.0},
        "breakdown": [
            {"group": "blue_dart", "orders": 60, "order_value": 30000.0, "cod_value": 5000.0},
            {"group": "COD", "orders": 30, "order_value": 8000.0, "cod_value": 8000.0},
            {"group": "Prepaid", "orders": 70, "order_value": 42000.0, "cod_value": 0},
            {"group": "Dabster (L1)", "orders": 100, "order_value": 50000.0, "cod_value": 8000.0},
        ],
    },
    "cod_remittance_summary": {
        "totals": {"records": 50, "remitted": 4000.0},
        "by_status": [{"status": "Pending", "records": 30, "remitted": 0}],
    },
    "cod_remittance_aging": {
        "totals": {"records": 50, "remitted": 4000.0, "outstanding": 3000.0, "settled_records": 20,
                   "overdue_records": 10, "overdue_amount": 1500.0, "pending_records": 30},
        "breakdown": [
            {"group": "BlueDart", "records": 30, "remitted": 2000.0, "outstanding": 1500.0,
             "overdue_records": 5, "pending_records": 25, "settled_records": 5, "mismatched_records": 0, "avg_tat_days": 3.0},
            {"group": "Settled", "records": 20, "avg_tat_days": 3.1, "settled_records": 20,
             "pending_records": 0, "overdue_records": 0, "mismatched_records": 0, "remitted": 2000.0, "outstanding": 0},
        ],
    },
    "geo_performance": {
        "totals": {"orders": 100, "delivered": 80, "rto": 5, "ndr": 10},
        "areas": [
            {"area": "Maharashtra", "orders": 60, "delivered": 50, "rto": 3, "ndr": 5, "avg_delivery_days": 6.0},
            # Negative avg_delivery_days — the backend guard must exclude it (never a negative state avg).
            {"area": "Jharkhand", "orders": 40, "delivered": 30, "rto": 2, "ndr": 3, "avg_delivery_days": -293.1},
        ],
    },
    "courier_performance": {"couriers": [{"courier_slug": "blue_dart", "total": 60, "delivery_rate_pct": 80.0}]},
    "rto_analysis": {"rto_orders": 5, "rto_cost": 100.0, "by_courier": [{"value": "blue_dart", "count": 3}], "by_state": []},
    "ndr_analysis": {"ndr_orders": 10, "avg_attempts": 1.5, "by_courier": [{"value": "blue_dart", "count": 6}]},
    "reconciliation_summary": {
        "totals": {"rate_diff": 500.0, "rows": 50, "disputed": 10},
        "breakdown": [{"group": "Disputed", "rate_diff": 500.0, "rows": 10, "disputed": 10}],
    },
    "weight_reconciliation_summary": {
        "rows": 50, "weight_overcharged": 10, "weight_diff_kg": 20.0, "fwd_rate_diff": 300.0,
        "by_status": {"Reconciled": 30, "Disputed": 20},
    },
    "daily_booking_trend": {"days": [{"day": "2026-06-01", "orders": 10, "order_value": 5000.0}]},
    "list_orders": {
        "total_matched": 2,
        "orders": [
            {"id": 1, "awb": "A1", "order_date": "2026-06-01", "shipping_company": "BlueDart",
             "courier_slug": "blue_dart", "total_weight_kg": 1.0, "actual_weight_kg": 0.9,
             "applied_courier_rate": 50.0, "cod_total": 0, "customer_state": "Maharashtra", "status": "Delivered",
             "pincode": "400001", "warehouse_id": 1, "payment_type": "Prepaid",
             "rate_summary": {"base_rates": {"forward": {"base_freight": 40.0, "gst": 8.0, "cod_charges": 0}}}},
            {"id": 2, "awb": "A2", "order_date": "2026-06-02", "shipping_company": "DTDC",
             "courier_slug": "dtdc", "total_weight_kg": 2.0, "actual_weight_kg": 1.8,
             "applied_courier_rate": 60.0, "cod_total": 100.0, "customer_state": "Gujarat", "status": "RTO",
             "pincode": "380001", "warehouse_id": 1, "payment_type": "COD",
             "rate_summary": {"base_rates": {"forward": {"base_freight": 50.0, "gst": 10.0, "cod_charges": 5.0}}}},
        ],
    },
}


@pytest.fixture
def mock_mcp(monkeypatch):
    """Install a fake mcp_client.call_tool that routes by tool name to PAYLOADS.
    `fail=True` makes every call raise → exercises the 'unavailable' fallback path."""
    def _install(*, fail: bool = False, overrides: dict | None = None):
        table = {**PAYLOADS, **(overrides or {})}

        async def _call(name, arguments=None):
            if fail:
                raise RuntimeError("MCP down (test)")
            if name not in table:
                raise AssertionError(f"test payload missing for tool {name!r}")
            return fake_result(table[name])

        monkeypatch.setattr("app.services.mcp_client.call_tool", _call)
    return _install


@pytest.fixture(autouse=True)
def _clear_caches():
    """Clear per-service + warm caches before each test so canned payloads never leak
    across tests (services cache by (from,to); tests reuse ranges)."""
    import app.services.mcp_client as mc
    from app.middleware.hardening import reset_rate_limits
    mc.clear_tool_cache()
    reset_rate_limits()
    for mod in ("sla_service", "cod_service", "zone_service", "weight_service",
                "courier_service", "discrepancy_service", "trend_service", "dashboard_service"):
        m = importlib.import_module(f"app.services.{mod}")
        for attr in ("_cache", "_rate_cache", "_billing_cache", "_pending_recon_cache",
                     "_pending_cache", "_intel_cache", "_dashboard_warm"):
            c = getattr(m, attr, None)
            if isinstance(c, dict):
                c.clear()
    yield
