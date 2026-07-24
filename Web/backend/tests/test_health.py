"""Health/readiness probe tests."""


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_health_live(client):
    r = client.get("/api/health/live")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "alive" and "uptime_seconds" in body


def test_health_ready_shape(client):
    r = client.get("/api/health/ready")
    body = r.json()
    assert {"status", "schedulers_started", "mcp_configured", "uptime_seconds"} <= set(body)
    # In tests the lifespan never runs, so schedulers_started is False → not_ready (503).
    assert r.status_code in (200, 503)
    assert body["status"] in ("ready", "not_ready")
