"""Single users store — now DATABASE-BACKED (the ONE source of user records).

Shared by auth_service, users_service, and profile_service so /api/profile,
/api/users, and login all read/write the same records (matched by id). The public
function surface is unchanged (returns `UserRecord` DTOs); only the internals moved
from an in-memory list to the SQLAlchemy `User` table.

There are NO hardcoded credentials. On first boot (empty table) a single admin is
seeded from `ADMIN_EMAIL`/`ADMIN_PASSWORD`; if no password is set, a random one is
generated and logged once. Passwords are always bcrypt-hashed (core.security).
"""

import logging
import secrets
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.auth.roles import Role
from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.database.session import SessionLocal, engine
from app.models.base import Base
from app.models.entities import SsoIdentity, User

logger = logging.getLogger("auth")


@dataclass
class UserRecord:
    id: int
    full_name: str
    email: str
    phone: str
    role: Role
    hashed_password: str


def _to_record(u: User) -> UserRecord:
    return UserRecord(
        id=u.id, full_name=u.full_name, email=u.email, phone=u.phone or "",
        role=Role(u.role), hashed_password=u.hashed_password,
    )


@contextmanager
def _session():
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def init_db_and_seed() -> None:
    """Create tables (idempotent) and seed the first admin if the table is empty.
    Called once at app startup (see main.py)."""
    Base.metadata.create_all(engine)
    with _session() as s:
        if s.scalar(select(func.count()).select_from(User)):
            return
        password = settings.admin_password or secrets.token_urlsafe(12)
        s.add(User(
            full_name="Administrator", email=settings.admin_email, phone="",
            role=Role.admin.value, hashed_password=hash_password(password),
        ))
        if settings.admin_password:
            logger.info("Seeded initial admin %s from ADMIN_PASSWORD.", settings.admin_email)
        else:
            logger.warning(
                "No ADMIN_PASSWORD set — seeded admin %s with a generated password: %s "
                "(log in and change it immediately).", settings.admin_email, password,
            )


def list_users() -> list[UserRecord]:
    with _session() as s:
        return [_to_record(u) for u in s.scalars(select(User).order_by(User.id)).all()]


def get_by_id(user_id: int) -> UserRecord | None:
    with _session() as s:
        u = s.get(User, user_id)
        return _to_record(u) if u else None


def get_by_email(email: str) -> UserRecord | None:
    with _session() as s:
        u = s.scalar(select(User).where(func.lower(User.email) == email.lower()))
        return _to_record(u) if u else None


def email_taken(email: str, exclude_id: int | None = None) -> bool:
    existing = get_by_email(email)
    return existing is not None and existing.id != exclude_id


def authenticate(email: str, password: str) -> UserRecord | None:
    user = get_by_email(email)
    if user and verify_password(password, user.hashed_password):
        return user
    return None


def verify(user: UserRecord, password: str) -> bool:
    return verify_password(password, user.hashed_password)


def set_password(user: UserRecord, new_password: str) -> None:
    hashed = hash_password(new_password)
    with _session() as s:
        row = s.get(User, user.id)
        if row is not None:
            row.hashed_password = hashed
    user.hashed_password = hashed  # keep the caller's DTO consistent


def create_user(
    full_name: str, email: str, phone: str, password: str, role: Role = Role.employee
) -> UserRecord:
    with _session() as s:
        row = User(
            full_name=full_name, email=email, phone=phone,
            role=role.value, hashed_password=hash_password(password),
        )
        s.add(row)
        s.flush()  # assigns row.id before the session closes
        return _to_record(row)


def update_user(
    user_id: int,
    *,
    full_name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    password: str | None = None,
) -> UserRecord | None:
    with _session() as s:
        row = s.get(User, user_id)
        if row is None:
            return None
        if full_name is not None:
            row.full_name = full_name
        if email is not None:
            row.email = email
        if phone is not None:
            row.phone = phone
        if password:
            row.hashed_password = hash_password(password)
        s.flush()
        return _to_record(row)


def delete_user(user_id: int) -> bool:
    with _session() as s:
        row = s.get(User, user_id)
        if row is None:
            return False
        # Drop its SSO link too (SQLite foreign keys may be off, so no cascade).
        s.execute(delete(SsoIdentity).where(SsoIdentity.user_id == user_id))
        s.delete(row)
        return True


# --- Single sign-on accounts (DeoDap Central) ---------------------------------------------------

SSO_LAST_SEEN_RESOLUTION = timedelta(minutes=1)


def _sso_email(s, wanted: str, fallback: str, user_id: int | None) -> str:
    """`wanted` unless another account already uses it; then the reserved `fallback` address.
    (An existing account is never taken over by matching its email.)"""
    other = s.scalar(select(User).where(func.lower(User.email) == wanted.lower()))
    return wanted if other is None or other.id == user_id else fallback


def upsert_sso_user(
    provider: str, subject: str, *, full_name: str, email: str, fallback_email: str, role: Role
) -> UserRecord:
    """The MCP account for an external identity: created on first use (random, unusable password),
    then kept in step with the identity provider's NAME and ROLE on every sign-in.

    The email is set only when single sign-on creates the account. It is never changed afterwards,
    so an existing account linked with `link-central-user` keeps the email it signs in with at
    MCP's normal login."""
    for attempt in range(2):
        try:
            with _session() as s:
                identity = s.scalar(
                    select(SsoIdentity).where(
                        SsoIdentity.provider == provider, SsoIdentity.subject == subject
                    )
                )
                row = s.get(User, identity.user_id) if identity is not None else None
                if identity is not None and row is None:  # its account was deleted: start again
                    s.delete(identity)
                    s.flush()
                    identity = None
                now = datetime.utcnow()
                if row is None:
                    row = User(
                        full_name=full_name,
                        email=_sso_email(s, email, fallback_email, None),
                        phone="",
                        role=role.value,
                        hashed_password=hash_password(secrets.token_urlsafe(32)),
                    )
                    s.add(row)
                    s.flush()
                    s.add(SsoIdentity(provider=provider, subject=subject, user_id=row.id,
                                      created_at=now, last_seen_at=now))
                    logger.info("Created MCP account %s for %s user %s (role %s).",
                                row.id, provider, subject, role.value)
                else:
                    if row.full_name != full_name:
                        row.full_name = full_name
                    if row.role != role.value:
                        logger.info("MCP account %s role %s -> %s (from %s).",
                                    row.id, row.role, role.value, provider)
                        row.role = role.value
                    if now - identity.last_seen_at > SSO_LAST_SEEN_RESOLUTION:
                        identity.last_seen_at = now
                s.flush()
                return _to_record(row)
        except IntegrityError:
            if attempt:  # a concurrent first sign-in created it: the retry reads it
                raise
    raise AssertionError("unreachable")


# --- Linking existing accounts (admin CLI: python -m app.cli link-central-user) ------------------


@dataclass
class SsoLink:
    provider: str
    subject: str
    user_id: int


def find_sso_link(
    provider: str, *, subject: str | None = None, user_id: int | None = None
) -> SsoLink | None:
    """The link for an external subject, or for an MCP account (exactly one of the two)."""
    if (subject is None) == (user_id is None):
        raise ValueError("give exactly one of subject / user_id")
    with _session() as s:
        query = select(SsoIdentity).where(SsoIdentity.provider == provider)
        query = query.where(SsoIdentity.subject == subject) if subject is not None \
            else query.where(SsoIdentity.user_id == user_id)
        row = s.scalar(query)
        return SsoLink(row.provider, row.subject, row.user_id) if row else None


def link_sso_identity(provider: str, subject: str, user_id: int) -> SsoLink:
    """Link an EXISTING MCP account to an external identity. Never matches by email.

    Raises LookupError if the account does not exist, ValueError if the subject or the account is
    already linked (also enforced by the table's unique constraints)."""
    with _session() as s:
        if s.get(User, user_id) is None:
            raise LookupError(f"MCP account {user_id} does not exist")
        taken = s.scalar(select(SsoIdentity).where(
            SsoIdentity.provider == provider,
            (SsoIdentity.subject == subject) | (SsoIdentity.user_id == user_id)))
        if taken is not None:
            raise ValueError(
                f"already linked: {provider} user {taken.subject} <-> MCP account {taken.user_id}"
            )
        now = datetime.utcnow()
        s.add(SsoIdentity(provider=provider, subject=subject, user_id=user_id, created_at=now,
                          last_seen_at=now))
    return SsoLink(provider, subject, user_id)


def unlink_sso_identity(
    provider: str, *, subject: str | None = None, user_id: int | None = None
) -> SsoLink | None:
    """Remove a link (the MCP account itself is kept). Returns what was removed, or None."""
    link = find_sso_link(provider, subject=subject, user_id=user_id)
    if link is None:
        return None
    with _session() as s:
        s.execute(delete(SsoIdentity).where(SsoIdentity.provider == provider,
                                            SsoIdentity.subject == link.subject))
    return link
