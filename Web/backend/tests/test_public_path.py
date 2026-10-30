"""Serving under a public sub-path (https://care.deodap.info/courier-billing/) + the httpOnly
session cookie that keeps the login token away from other apps on the shared domain.

- The proxy strips the sub-path and names it in X-Forwarded-Prefix; only allow-listed values are
  honoured (they are written into the page and the cookie path), forged ones are ignored.
- The page is served with prefixed asset URLs and a base-path meta tag; without the header it is
  served unchanged (the existing nip.io URL keeps working).
- Login sets an httpOnly, SameSite=Strict cookie scoped to "<prefix>/api"; the API accepts it;
  data-changing cookie requests need the X-Requested-With header (CSRF); logout clears it.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app import main
from app.auth.roles import Role
from app.core.base_path import public_prefix
from app.core.config import settings
from app.main import app
from app.services import user_store

PREFIX = {"X-Forwarded-Prefix": "/courier-billing"}


def _request(headers: dict[str, str]) -> Request:
    return Request({
        "type": "http", "method": "GET", "path": "/", "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
    })


@pytest.fixture
def plain_client():
    """A client WITHOUT the auth override, so the real cookie flow runs."""
    app.dependency_overrides.clear()
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def user():
    email = f"cookie.{uuid.uuid4().hex[:8]}@deodap.com"
    user_store.create_user(full_name="Cookie User", email=email, phone="1",
                           password="cookie-pass-1", role=Role.employee)
    return email, "cookie-pass-1"


def test_only_allow_listed_prefixes_are_honoured():
    assert public_prefix({"x-forwarded-prefix": "/courier-billing"}) == "/courier-billing"
    assert public_prefix({"x-forwarded-prefix": "/courier-billing/"}) == "/courier-billing"
    assert public_prefix({"x-forwarded-prefix": '/x"><script>alert(1)</script>'}) == ""
    assert public_prefix({"x-forwarded-prefix": "/other-app"}) == ""
    assert public_prefix({}) == ""


def test_page_is_served_with_prefixed_assets_and_base_meta(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text(
        '<html><head><script src="/theme-init.js"></script>'
        '<script type="module" src="/assets/index-a.js"></script>'
        '<link rel="stylesheet" href="/assets/index-b.css"><link href="https://fonts.googleapis.com/x">'
        "</head><body></body></html>", encoding="utf-8")
    monkeypatch.setattr(main, "_FRONTEND_DIR", tmp_path)
    monkeypatch.setattr(main, "_index_cache", {})

    plain = main._index_response(_request({})).body.decode()
    assert 'src="/assets/index-a.js"' in plain and "app-base-path" not in plain  # nip.io: unchanged

    sub = main._index_response(_request(PREFIX)).body.decode()
    assert '<meta name="app-base-path" content="/courier-billing" />' in sub
    assert 'src="/courier-billing/assets/index-a.js"' in sub
    assert 'href="/courier-billing/assets/index-b.css"' in sub
    assert 'src="/courier-billing/theme-init.js"' in sub
    assert 'href="https://fonts.googleapis.com/x"' in sub  # absolute URLs untouched

    forged = main._index_response(_request({"X-Forwarded-Prefix": "/evil"})).body.decode()
    assert forged == plain


def test_login_sets_an_httponly_cookie_scoped_to_the_api_path(plain_client, user):
    email, password = user
    r = plain_client.post("/api/login", json={"email": email, "password": password},
                          headers={**PREFIX, "X-Forwarded-Proto": "https"})
    assert r.status_code == 200
    cookie = r.headers["set-cookie"].lower()
    assert f"{settings.auth_cookie_name}=" in cookie
    assert "httponly" in cookie and "samesite=strict" in cookie and "secure" in cookie
    assert "path=/courier-billing/api" in cookie

    direct = plain_client.post("/api/login", json={"email": email, "password": password})
    assert "path=/api" in direct.headers["set-cookie"].lower()


def test_the_cookie_authenticates_and_logout_ends_the_session(plain_client, user):
    email, password = user
    login = plain_client.post("/api/login", json={"email": email, "password": password})
    token = login.cookies[settings.auth_cookie_name]
    cookies = {settings.auth_cookie_name: token}

    me = plain_client.get("/api/me", cookies=cookies)
    assert me.status_code == 200 and me.json()["email"] == email

    out = plain_client.post("/api/logout")
    assert out.status_code == 204
    assert f"{settings.auth_cookie_name}=" in out.headers["set-cookie"]
    assert 'max-age=0' in out.headers["set-cookie"].lower()

    assert plain_client.get("/api/me").status_code == 401  # no cookie, no header


def test_cookie_requests_that_change_data_need_the_csrf_header(plain_client, user):
    email, password = user
    token = plain_client.post("/api/login", json={"email": email, "password": password}).cookies[settings.auth_cookie_name]
    cookies = {settings.auth_cookie_name: token}
    body = {"current_password": password, "new_password": "cookie-pass-2"}

    blocked = plain_client.post("/api/profile/change-password", json=body, cookies=cookies)
    assert blocked.status_code == 403  # a cross-site form can't add the header

    allowed = plain_client.post("/api/profile/change-password", json=body, cookies=cookies,
                                headers={"X-Requested-With": "XMLHttpRequest"})
    assert allowed.status_code != 403


def test_bearer_tokens_still_work_without_a_cookie(plain_client, user):
    email, password = user
    token = plain_client.post("/api/login", json={"email": email, "password": password}).json()["access_token"]
    plain_client.cookies.clear()
    r = plain_client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json()["email"] == email
