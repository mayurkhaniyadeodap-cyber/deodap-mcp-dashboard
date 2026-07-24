"""Security-hardening tests (Phase 5): headers, rate limiting, env validation."""


def test_security_headers_present(client):
    h = client.get("/api/health").headers
    assert "content-security-policy" in h
    assert h["x-frame-options"] == "DENY"
    assert h["x-content-type-options"] == "nosniff"
    assert "referrer-policy" in h
    assert "permissions-policy" in h
    assert "strict-transport-security" in h


def test_login_is_rate_limited(client):
    # login bucket = 10 / 60s → the 11th+ request in the window returns 429,
    # regardless of the login result (the limiter runs before the endpoint).
    codes = [
        client.post("/api/login", json={"email": "x@example.com", "password": "bad"}).status_code
        for _ in range(12)
    ]
    assert 429 in codes
    assert codes[-1] == 429


def test_non_sensitive_routes_not_rate_limited(client):
    # A normal read endpoint must never be limited by the login/admin/export/debug rules.
    codes = [client.get("/api/health").status_code for _ in range(30)]
    assert all(c == 200 for c in codes)


def test_env_validation_flags_missing_in_production(monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "environment", "production")
    monkeypatch.setattr(config.settings, "jwt_secret", "too-short")
    missing = config.validate_required_env()
    assert any("JWT_SECRET" in m for m in missing)


def test_env_validation_silent_in_dev():
    from app.core import config

    assert config.validate_required_env() == []  # dev default: nothing required
