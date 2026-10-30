"""DeoDap Central single sign-on: verify Central-signed assertions with Central's PUBLIC key.

DeoDap Central's workspace gateway re-checks the Central session and the user's MCP Dashboard
permission on every request, then sends `Authorization: Bearer <assertion>`: a compact JWS signed
with Central's Ed25519 private key. This module verifies it using only Central's public key
(`CENTRAL_SSO_PUBLIC_KEY_FILE`), so this app never holds a Central secret and Central never holds
this app's JWT secret.

Checks (any failure -> not authenticated):
  - header is exactly alg "EdDSA" (no algorithm negotiation) with the configured key's `kid`;
  - Ed25519 signature over the header and payload;
  - iss / aud equal the configured issuer / audience;
  - iat / nbf not in the future, exp not passed (5 s clock leeway), exp - iat within the limit;
  - each assertion id (`jti`) is accepted once: ids are stored in the `sso_used_assertions` table
    until they expire, so a replay is refused even after a restart or on another worker;
  - role is "admin" or "user"; sub is a Central user id.

Role mapping: Central Admin -> MCP admin; Central User -> MCP employee. The MCP account is created
on first use (random, unusable password); afterwards Central keeps its NAME and ROLE in step, never
its email. An existing account can be linked instead with `python -m app.cli link-central-user`.
The app's own login (HS256 tokens) is unchanged and keeps working for standalone use.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import time
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError

from app.auth.roles import Role
from app.core.config import settings
from app.database.session import SessionLocal
from app.models.entities import SsoUsedAssertion
from app.schemas.auth import UserPublic
from app.services import user_store

logger = logging.getLogger("auth")

PROVIDER = "deodap-central"
ALGORITHM = "EdDSA"
CLOCK_LEEWAY_SECONDS = 5
MAX_TOKEN_LENGTH = 4096
ROLE_MAP = {"admin": Role.admin, "user": Role.employee}
FALLBACK_EMAIL_DOMAIN = "deodap-central.example.com"  # reserved (RFC 2606): never a real mailbox
BACKEND_DIR = Path(__file__).resolve().parents[2]


PURGE_INTERVAL_SECONDS = 60
MAX_JTI_LENGTH = 128
_last_purge = 0.0  # time.monotonic() of the last clean-up in this process


def purge_expired_assertions(now: datetime | None = None) -> int:
    """Delete stored assertion ids whose assertion has expired. Returns how many were removed."""
    now = now or datetime.utcnow()
    with SessionLocal() as s:
        expired = delete(SsoUsedAssertion).where(SsoUsedAssertion.expires_at < now)
        removed = s.execute(expired).rowcount
        s.commit()
    return removed or 0


def _first_use(jti: str, exp: float) -> bool:
    """Record `jti` as used. False if it was already used (a replay). The primary key makes this
    atomic across requests, worker processes and restarts."""
    global _last_purge
    if time.monotonic() - _last_purge > PURGE_INTERVAL_SECONDS:
        _last_purge = time.monotonic()
        purge_expired_assertions()
    keep_until = datetime.utcfromtimestamp(exp + CLOCK_LEEWAY_SECONDS)
    with SessionLocal() as s:
        s.add(SsoUsedAssertion(jti=jti, expires_at=keep_until))
        try:
            s.commit()
            return True
        except IntegrityError:
            s.rollback()
            return False


def _b64decode(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def key_id(public_key: Ed25519PublicKey) -> str:
    raw = public_key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return hashlib.sha256(raw).hexdigest()[:16]


@lru_cache(maxsize=4)
def _load_public_key(path_setting: str) -> tuple[Ed25519PublicKey, str] | None:
    if not path_setting:
        return None
    path = Path(path_setting)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    try:
        key = serialization.load_pem_public_key(path.read_bytes())
    except (OSError, ValueError) as exc:
        logger.error(
            "Central SSO disabled: cannot read public key %s (%s).", path, exc.__class__.__name__
        )
        return None
    if not isinstance(key, Ed25519PublicKey):
        logger.error("Central SSO disabled: %s is not an Ed25519 public key.", path)
        return None
    return key, key_id(key)


def enabled() -> bool:
    return _load_public_key(settings.central_sso_public_key_file) is not None


def looks_like_central_assertion(token: str) -> bool:
    """Route by the (unverified) header: EdDSA tokens are Central assertions, everything else is the
    app's own HS256 login token. Each path then pins its own algorithm and key."""
    try:
        header = json.loads(_b64decode(token.split(".", 1)[0]))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return False
    return isinstance(header, dict) and header.get("alg") == ALGORITHM


def verify(token: str, *, now: float | None = None) -> dict | None:
    """The verified claims, or None."""
    loaded = _load_public_key(settings.central_sso_public_key_file)
    if loaded is None or not token or len(token) > MAX_TOKEN_LENGTH:
        return None
    public_key, kid = loaded
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
        header = json.loads(_b64decode(header_b64))
        if header != {"alg": ALGORITHM, "typ": "JWT", "kid": kid}:
            return None
        public_key.verify(_b64decode(signature_b64), f"{header_b64}.{payload_b64}".encode())
        claims = json.loads(_b64decode(payload_b64))
    except (ValueError, binascii.Error, UnicodeDecodeError, InvalidSignature):
        return None
    if not isinstance(claims, dict):
        return None

    now = time.time() if now is None else now
    try:
        iat, nbf, exp = (
            float(claims["iat"]),
            float(claims.get("nbf", claims["iat"])),
            float(claims["exp"]),
        )
        sub, role, jti = str(claims["sub"]), claims["role"], str(claims["jti"])
        email, name = str(claims["email"]), str(claims["name"])
    except (KeyError, TypeError, ValueError):
        return None
    if (
        claims.get("iss") != settings.central_sso_issuer
        or claims.get("aud") != settings.central_sso_audience
    ):
        return None
    if (
        iat > now + CLOCK_LEEWAY_SECONDS
        or nbf > now + CLOCK_LEEWAY_SECONDS
        or exp <= now - CLOCK_LEEWAY_SECONDS
    ):
        return None
    if exp - iat <= 0 or exp - iat > settings.central_sso_max_lifetime_seconds:
        return None
    if role not in ROLE_MAP or not sub.isdigit() or "@" not in email:
        return None
    if not 16 <= len(jti) <= MAX_JTI_LENGTH:
        return None
    if not _first_use(jti, exp):
        return None  # replayed
    claims.update(sub=sub, email=email[:255], name=(name.strip() or f"Central user {sub}")[:120])
    return claims


_EMAIL = TypeAdapter(EmailStr)


def _acceptable_email(email: str) -> bool:
    """Central accepts some addresses this app does not (e.g. reserved domains like *.test/*.local);
    those accounts get the reserved fallback address instead of failing."""
    try:
        _EMAIL.validate_python(email)
        return True
    except ValidationError:
        return False


def authenticate(token: str) -> UserPublic | None:
    """Verify a Central assertion and return its MCP user (created/updated as needed)."""
    claims = verify(token)
    if claims is None:
        return None
    fallback = f"central-user-{claims['sub']}@{FALLBACK_EMAIL_DOMAIN}"
    record = user_store.upsert_sso_user(
        PROVIDER,
        claims["sub"],
        full_name=claims["name"],
        email=claims["email"] if _acceptable_email(claims["email"]) else fallback,
        fallback_email=fallback,
        role=ROLE_MAP[claims["role"]],
    )
    return UserPublic(id=record.id, name=record.full_name, email=record.email, role=record.role)
