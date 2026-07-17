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

from sqlalchemy import func, select

from app.auth.roles import Role
from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.database.session import SessionLocal, engine
from app.models.base import Base
from app.models.entities import User

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
        s.delete(row)
        return True
