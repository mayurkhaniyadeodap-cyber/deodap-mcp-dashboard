"""DeoDap Central single sign-on: Ed25519 assertions verified with Central's PUBLIC key.

Each test uses its own throwaway key pair and a fresh temporary database
(scripts/test_mcp_dashboard.ps1 points DATABASE_URL at a new file). The signer below is written
from the wire format on purpose, so the tests check the contract rather than reusing Central's code.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import importlib
import json
import secrets
import time
from datetime import datetime, timedelta

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import central_sso
from app.auth.roles import Role
from app.core.config import settings
from app.database.session import SessionLocal
from app.main import app
from app.models.entities import SsoIdentity, SsoUsedAssertion, User
from app.services import user_store


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _kid(key: Ed25519PrivateKey) -> str:
    raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return hashlib.sha256(raw).hexdigest()[:16]


def _jws(header: dict, payload: dict, sign) -> str:
    signing_input = f"{_b64(json.dumps(header).encode())}.{_b64(json.dumps(payload).encode())}"
    return f"{signing_input}.{_b64(sign(signing_input.encode()))}"


@pytest.fixture
def central_key(tmp_path, monkeypatch) -> Ed25519PrivateKey:
    """A fresh Central key pair; this app is configured with its PUBLIC half only."""
    key = Ed25519PrivateKey.generate()
    public_file = tmp_path / "central_public.pem"
    public_file.write_bytes(
        key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
    )
    monkeypatch.setattr(settings, "central_sso_public_key_file", str(public_file))
    central_sso._load_public_key.cache_clear()
    yield key
    central_sso._load_public_key.cache_clear()


@pytest.fixture
def client():
    return TestClient(app)  # real authentication (no dependency override), no lifespan


def assertion(
    key: Ed25519PrivateKey,
    *,
    sub: str | None = None,
    role: str = "user",
    email: str | None = None,
    name: str = "Central Person",
    now: float | None = None,
    ttl: int = 60,
    **overrides,
) -> str:
    now = int(time.time() if now is None else now)
    sub = sub or str(secrets.randbelow(10**9) + 1000)
    payload = {
        "iss": "deodap-central",
        "aud": "mcp-dashboard",
        "sub": sub,
        "role": role,
        "email": email or f"person{sub}@deodap.com",
        "name": name,
        "iat": now,
        "nbf": now,
        "exp": now + ttl,
        "jti": secrets.token_urlsafe(16),
    }
    payload.update(overrides.pop("payload", {}))
    header = {"alg": "EdDSA", "typ": "JWT", "kid": _kid(key)}
    header.update(overrides.pop("header", {}))
    return _jws(header, payload, key.sign)


def me(client, token: str):
    return client.get("/api/me", headers={"Authorization": f"Bearer {token}"})


def account(user_id: int) -> User:
    with SessionLocal() as s:
        return s.get(User, user_id)


# ---------- Role mapping and account creation ----------


def test_central_admin_is_an_mcp_admin(client, central_key):
    response = me(
        client,
        assertion(central_key, role="admin", name="Logistic Admin", email="admin.sso@deodap.com"),
    )
    assert response.status_code == 200
    body = response.json()
    assert (
        body["role"] == "admin"
        and body["name"] == "Logistic Admin"
        and body["email"] == "admin.sso@deodap.com"
    )
    # Admin-only MCP endpoints are open to it.
    assert (
        client.get(
            "/api/users",
            headers={"Authorization": f"Bearer {assertion(central_key, sub='77', role='admin')}"},
        ).status_code
        == 200
    )


def test_central_user_is_an_mcp_employee(client, central_key):
    body = me(client, assertion(central_key, role="user")).json()
    assert body["role"] == "employee"
    users = client.get(
        "/api/users", headers={"Authorization": f"Bearer {assertion(central_key, role='user')}"}
    )
    assert users.status_code == 403  # no MCP user management for Central Users


def test_account_is_created_once_and_linked_to_the_central_id(client, central_key):
    first = me(client, assertion(central_key, sub="501", name="Asha")).json()
    second = me(client, assertion(central_key, sub="501", name="Asha")).json()
    assert first["id"] == second["id"]
    with SessionLocal() as s:
        identity = s.scalar(
            select(SsoIdentity).where(
                SsoIdentity.provider == "deodap-central", SsoIdentity.subject == "501"
            )
        )
        assert identity is not None and identity.user_id == first["id"]
    other = me(client, assertion(central_key, sub="502")).json()
    assert other["id"] != first["id"]


def test_sso_accounts_get_an_unusable_random_password(client, central_key):
    body = me(client, assertion(central_key, sub="503", email="nopass@deodap.com")).json()
    row = account(body["id"])
    assert row.hashed_password.startswith("$2")  # bcrypt of a random value nobody knows
    for guess in ("", "password", "nopass@deodap.com", "503"):
        assert user_store.authenticate("nopass@deodap.com", guess) is None


def test_name_and_role_follow_central_but_the_email_never_changes(client, central_key):
    first = me(
        client,
        assertion(central_key, sub="504", role="admin", name="Before", email="before@deodap.com"),
    ).json()
    assert (
        first["email"] == "before@deodap.com"
    )  # set once, when single sign-on creates the account
    later = me(
        client,
        assertion(central_key, sub="504", role="user", name="After", email="after@deodap.com"),
    ).json()
    assert later == {
        **first,
        "role": "employee",
        "name": "After",
        "email": "before@deodap.com",  # unchanged: the account's email is never overwritten
    }  # same account
    again = me(
        client,
        assertion(central_key, sub="504", role="admin", name="After", email="after@deodap.com"),
    ).json()
    assert again["role"] == "admin" and again["id"] == first["id"]


def test_existing_local_account_is_never_taken_over(client, central_key):
    local = user_store.create_user(
        full_name="Local Person",
        email="same@deodap.com",
        phone="123",
        password="local-password-1",
        role=Role.employee,
    )
    body = me(
        client, assertion(central_key, sub="505", role="admin", email="same@deodap.com")
    ).json()
    assert body["id"] != local.id
    assert (
        body["email"] == "central-user-505@deodap-central.example.com"
    )  # reserved address instead
    untouched = account(local.id)
    assert untouched.full_name == "Local Person" and untouched.role == "employee"
    assert (
        user_store.authenticate("same@deodap.com", "local-password-1") is not None
    )  # still signs in locally


@pytest.mark.parametrize(
    "central_email", ["e2e-admin@example.test", "someone@team.local", "a@localhost"]
)
def test_central_emails_this_app_rejects_get_the_reserved_address(
    client, central_key, central_email
):
    """Regression: Central allows reserved domains (*.test, *.local) that this app's EmailStr
    refuses; signing in must not fail (it returned 500 before)."""
    sub = str(secrets.randbelow(10**6) + 10**7)
    response = me(client, assertion(central_key, sub=sub, role="admin", email=central_email))
    assert response.status_code == 200
    assert response.json()["email"] == f"central-user-{sub}@deodap-central.example.com"
    assert response.json()["role"] == "admin"


def test_deleted_sso_account_is_recreated(client, central_key):
    first = me(client, assertion(central_key, sub="506")).json()
    assert user_store.delete_user(first["id"])
    second = me(client, assertion(central_key, sub="506")).json()
    assert second["role"] == "employee"
    with SessionLocal() as s:
        identities = s.scalars(select(SsoIdentity).where(SsoIdentity.subject == "506")).all()
        assert [i.user_id for i in identities] == [second["id"]]


# ---------- Rejected assertions ----------


def test_invalid_signature_is_rejected(client, central_key):
    stranger = Ed25519PrivateKey.generate()
    forged = assertion(stranger, header={"kid": _kid(central_key)})  # right kid, wrong key
    assert me(client, forged).status_code == 401


def test_tampered_payload_is_rejected(client, central_key):
    header_b64, _, signature_b64 = assertion(central_key, sub="507", role="user").split(".")
    now = int(time.time())
    elevated = _b64(
        json.dumps(
            {
                "iss": "deodap-central",
                "aud": "mcp-dashboard",
                "sub": "507",
                "role": "admin",
                "email": "x@deodap.com",
                "name": "x",
                "iat": now,
                "nbf": now,
                "exp": now + 60,
                "jti": secrets.token_urlsafe(16),
            }
        ).encode()
    )
    assert me(client, f"{header_b64}.{elevated}.{signature_b64}").status_code == 401
    assert me(client, assertion(central_key)[:-6]).status_code == 401  # truncated signature


def test_expired_and_not_yet_valid_assertions_are_rejected(client, central_key):
    assert me(client, assertion(central_key, now=time.time() - 120)).status_code == 401  # expired
    assert (
        me(client, assertion(central_key, now=time.time() + 300)).status_code == 401
    )  # issued in the future
    assert (
        me(client, assertion(central_key, ttl=3600)).status_code == 401
    )  # lifetime longer than allowed


def test_wrong_issuer_audience_or_key_id_is_rejected(client, central_key):
    assert me(client, assertion(central_key, payload={"iss": "someone-else"})).status_code == 401
    assert me(client, assertion(central_key, payload={"aud": "another-app"})).status_code == 401
    assert me(client, assertion(central_key, header={"kid": "0" * 16})).status_code == 401


@pytest.mark.parametrize(
    "bad",
    [
        {"role": "superadmin"},
        {"role": "employee"},
        {"sub": "../1"},
        {"sub": ""},
        {"email": "no-at-sign"},
        {"jti": "short"},
    ],
)
def test_malformed_claims_are_rejected(client, central_key, bad):
    assert me(client, assertion(central_key, payload=bad)).status_code == 401


def test_algorithm_confusion_is_rejected(client, central_key):
    public_pem = central_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    now = int(time.time())
    claims = {"sub": "1", "role": "admin", "iat": now, "exp": now + 60}
    # HS256 "signed" with the public key as the secret: handled by the normal login path,
    # which fails.
    hs = _jws(
        {"alg": "HS256", "typ": "JWT"},
        claims,
        lambda m: hmac.new(public_pem, m, hashlib.sha256).digest(),
    )
    assert me(client, hs).status_code == 401
    # Unsigned tokens.
    assert me(client, _jws({"alg": "none", "typ": "JWT"}, claims, lambda m: b"")).status_code == 401
    assert (
        me(
            client, assertion(central_key, header={"alg": "EdDSA", "typ": "JWT", "extra": 1})
        ).status_code
        == 401
    )


def test_an_assertion_is_accepted_only_once(client, central_key):
    token = assertion(central_key, sub="508")
    assert me(client, token).status_code == 200
    assert me(client, token).status_code == 401  # replay


def test_replay_is_rejected_after_a_service_restart(client, central_key):
    """Used assertion ids live in the database, not in memory: a fresh process still refuses
    them."""
    token = assertion(central_key, sub="510")
    assert me(client, token).status_code == 200
    # Simulate a restart: reload the module (fresh process state) and use a new client.
    importlib.reload(central_sso)
    central_sso._load_public_key.cache_clear()
    restarted = TestClient(app)
    assert me(restarted, token).status_code == 401
    jti = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))["jti"]
    with SessionLocal() as s:
        assert s.get(SsoUsedAssertion, jti) is not None


def test_expired_assertion_ids_are_purged_but_valid_ones_kept(client, central_key):
    token = assertion(central_key, sub="511")
    assert me(client, token).status_code == 200
    jti = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))["jti"]
    with SessionLocal() as s:
        s.add(
            SsoUsedAssertion(
                jti="old-" + "x" * 20, expires_at=datetime.utcnow() - timedelta(hours=1)
            )
        )
        s.commit()
    assert central_sso.purge_expired_assertions() >= 1
    with SessionLocal() as s:
        assert s.get(SsoUsedAssertion, "old-" + "x" * 20) is None  # expired: deleted
        assert s.get(SsoUsedAssertion, jti) is not None  # still valid: kept (replay still refused)
    assert me(client, token).status_code == 401


def test_overlong_assertion_id_is_rejected(client, central_key):
    assert me(client, assertion(central_key, payload={"jti": "j" * 200})).status_code == 401


def test_access_ends_when_central_stops_issuing_assertions(central_key):
    """Central issues a new assertion only after re-checking the session, the account and the
    project permission. A disabled user or revoked permission therefore gets no new assertion,
    and an old one stops working at its expiry (60 s from Central; at most 120 s accepted)."""
    token = assertion(central_key, sub="509")
    exp = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))["exp"]
    assert central_sso.verify(token, now=exp + central_sso.CLOCK_LEEWAY_SECONDS + 1) is None


def test_garbage_bearer_values_are_rejected(client, central_key):
    for value in ("x", "a.b.c", "....", "e30.e30.", "Bearer"):
        assert me(client, value).status_code == 401


# ---------- Standalone use is unchanged ----------


def test_without_a_central_public_key_sso_is_off_and_own_login_still_works(client, monkeypatch):
    key = Ed25519PrivateKey.generate()
    monkeypatch.setattr(settings, "central_sso_public_key_file", "")
    central_sso._load_public_key.cache_clear()
    assert central_sso.enabled() is False
    assert me(client, assertion(key, role="admin")).status_code == 401

    user_store.create_user(
        full_name="Standalone",
        email="standalone@deodap.com",
        phone="1",
        password="standalone-pass-1",
        role=Role.employee,
    )
    login = client.post(
        "/api/login", json={"email": "standalone@deodap.com", "password": "standalone-pass-1"}
    )
    assert login.status_code == 200
    assert me(client, login.json()["access_token"]).json()["email"] == "standalone@deodap.com"
    central_sso._load_public_key.cache_clear()


def test_own_login_still_works_when_sso_is_on(client, central_key):
    user_store.create_user(
        full_name="Local Two",
        email="local.two@deodap.com",
        phone="1",
        password="local-two-pass-1",
        role=Role.employee,
    )
    login = client.post(
        "/api/login", json={"email": "local.two@deodap.com", "password": "local-two-pass-1"}
    )
    assert login.status_code == 200
    assert me(client, login.json()["access_token"]).json()["email"] == "local.two@deodap.com"
