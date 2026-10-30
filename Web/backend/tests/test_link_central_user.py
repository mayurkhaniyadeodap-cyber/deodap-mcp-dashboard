"""`python -m app.cli link-central-user`: link an EXISTING MCP account to a DeoDap Central user.

Runs against the fresh temporary database set up by scripts/test_mcp_dashboard.ps1.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import cli
from app.auth import central_sso
from app.auth.roles import Role
from app.core.config import settings
from app.database.session import SessionLocal
from app.main import app
from app.models.entities import SsoIdentity, User
from app.services import user_store


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


@pytest.fixture
def central_key(tmp_path, monkeypatch) -> Ed25519PrivateKey:
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


def assertion(key: Ed25519PrivateKey, sub: str, role: str, email: str, name: str) -> str:
    raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    header = {"alg": "EdDSA", "typ": "JWT", "kid": hashlib.sha256(raw).hexdigest()[:16]}
    now = int(time.time())
    payload = {
        "iss": "deodap-central",
        "aud": "mcp-dashboard",
        "sub": sub,
        "role": role,
        "email": email,
        "name": name,
        "iat": now,
        "nbf": now,
        "exp": now + 60,
        "jti": secrets.token_urlsafe(16),
    }
    signing_input = f"{_b64(json.dumps(header).encode())}.{_b64(json.dumps(payload).encode())}"
    return f"{signing_input}.{_b64(key.sign(signing_input.encode()))}"


def sso_me(key, sub, role="user", email="central@deodap.com", name="Central Name") -> dict:
    token = assertion(key, sub, role, email, name)
    response = TestClient(app).get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.text
    return response.json()


def new_account(role: Role = Role.employee, email: str | None = None) -> int:
    email = email or f"local{secrets.randbelow(10**9)}@deodap.com"
    return user_store.create_user(
        full_name="Local Person", email=email, phone="1", password="local-password-1", role=role
    ).id


def central_id() -> int:
    return secrets.randbelow(10**8) + 10**8


def run(*args: str, answer: str = "yes") -> int:
    return cli.main(["link-central-user", *args], input_fn=lambda _prompt: answer)


def link_of(subject: int):
    return user_store.find_sso_link(central_sso.PROVIDER, subject=str(subject))


# ---------- Linking ----------


def test_link_then_sso_uses_the_existing_account(central_key, capsys):
    mcp_id, cid = new_account(Role.employee, "existing.person@deodap.com"), central_id()
    assert (
        run("--central-user-id", str(cid), "--central-role", "user", "--mcp-user-id", str(mcp_id))
        == 0
    )
    out = capsys.readouterr().out
    assert "Current MCP role: employee" in out and "Central role:  user" in out
    assert link_of(cid).user_id == mcp_id

    me = sso_me(
        central_key, str(cid), role="user", email="different@deodap.com", name="Name From Central"
    )
    assert me["id"] == mcp_id  # the linked account, not a new one
    assert me["email"] == "existing.person@deodap.com"  # email never changed by single sign-on
    assert me["name"] == "Name From Central"  # name follows Central
    # Its normal MCP login (email + password) still works.
    assert user_store.authenticate("existing.person@deodap.com", "local-password-1") is not None


def test_role_difference_is_refused_without_allow_role_change(central_key, capsys):
    mcp_id, cid = new_account(Role.admin), central_id()
    assert (
        run("--central-user-id", str(cid), "--central-role", "user", "--mcp-user-id", str(mcp_id))
        == 1
    )
    out = capsys.readouterr().out
    assert "Current MCP role: admin" in out and "MCP role employee" in out and "Refused" in out
    assert link_of(cid) is None  # nothing written

    assert (
        run(
            "--central-user-id",
            str(cid),
            "--central-role",
            "user",
            "--mcp-user-id",
            str(mcp_id),
            "--allow-role-change",
        )
        == 0
    )
    assert (
        sso_me(central_key, str(cid), role="user")["role"] == "employee"
    )  # Central decides the role


def test_double_link_is_refused_on_both_sides(capsys):
    first, second = new_account(), new_account()
    cid, other_cid = central_id(), central_id()
    assert (
        run("--central-user-id", str(cid), "--central-role", "user", "--mcp-user-id", str(first))
        == 0
    )
    # The same Central user to another account.
    assert (
        run("--central-user-id", str(cid), "--central-role", "user", "--mcp-user-id", str(second))
        == 1
    )
    assert f"Central user {cid} is already linked to MCP account {first}" in capsys.readouterr().out
    # Another Central user to the same account.
    assert (
        run(
            "--central-user-id",
            str(other_cid),
            "--central-role",
            "user",
            "--mcp-user-id",
            str(first),
        )
        == 1
    )
    assert f"MCP account {first} is already linked to Central user {cid}" in capsys.readouterr().out
    assert link_of(cid).user_id == first and link_of(other_cid) is None


def test_unlink_removes_only_the_link(central_key):
    mcp_id, cid = new_account(), central_id()
    run("--central-user-id", str(cid), "--central-role", "user", "--mcp-user-id", str(mcp_id))
    assert run("--unlink", "--mcp-user-id", str(mcp_id)) == 0
    assert link_of(cid) is None
    assert user_store.get_by_id(mcp_id) is not None  # the account itself is kept
    created = sso_me(central_key, str(cid))  # next sign-in creates a NEW account
    assert created["id"] != mcp_id
    assert run("--unlink", "--central-user-id", str(cid)) == 0  # unlink by Central id works too
    assert run("--unlink", "--central-user-id", str(cid)) == 1  # nothing left to unlink


def test_no_automatic_linking_by_email(central_key):
    existing = new_account(Role.employee, "same.email@deodap.com")
    cid = central_id()
    me = sso_me(central_key, str(cid), role="user", email="same.email@deodap.com")
    assert me["id"] != existing  # same email, but NOT linked: a separate account was created
    assert link_of(cid).user_id == me["id"]
    with SessionLocal() as s:
        assert s.scalar(select(SsoIdentity).where(SsoIdentity.user_id == existing)) is None
        assert s.get(User, existing).full_name == "Local Person"  # untouched


def test_nothing_changes_without_confirmation(capsys):
    mcp_id, cid = new_account(), central_id()
    assert (
        run(
            "--central-user-id",
            str(cid),
            "--central-role",
            "user",
            "--mcp-user-id",
            str(mcp_id),
            answer="no",
        )
        == 1
    )
    assert "Cancelled. Nothing changed." in capsys.readouterr().out
    assert link_of(cid) is None

    def no_terminal(_prompt):
        raise EOFError

    assert (
        cli.main(
            [
                "link-central-user",
                "--central-user-id",
                str(cid),
                "--central-role",
                "user",
                "--mcp-user-id",
                str(mcp_id),
            ],
            input_fn=no_terminal,
        )
        == 1
    )
    assert link_of(cid) is None


def test_yes_flag_skips_the_question():
    mcp_id, cid = new_account(), central_id()

    def must_not_ask(_prompt):
        raise AssertionError("asked for confirmation despite --yes")

    assert (
        cli.main(
            [
                "link-central-user",
                "--central-user-id",
                str(cid),
                "--central-role",
                "user",
                "--mcp-user-id",
                str(mcp_id),
                "--yes",
            ],
            input_fn=must_not_ask,
        )
        == 0
    )
    assert link_of(cid).user_id == mcp_id


def test_unknown_account_and_bad_arguments_are_refused(capsys):
    cid = central_id()
    assert (
        run("--central-user-id", str(cid), "--central-role", "user", "--mcp-user-id", "999999999")
        == 1
    )
    assert "does not exist" in capsys.readouterr().out
    assert run("--central-user-id", str(cid), "--mcp-user-id", "1") == 2  # --central-role missing
    assert run("--unlink", "--central-user-id", str(cid), "--mcp-user-id", "1") == 2  # both ids
    with pytest.raises(SystemExit):
        run("--central-user-id", "-5", "--central-role", "user", "--mcp-user-id", "1")
    assert link_of(cid) is None
