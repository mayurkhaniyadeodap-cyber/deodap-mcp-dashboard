"""Auth service — thin adapter over the shared user_store (the single source of
users). Public API and behavior are unchanged: login/token issuance and
get_current_user still work exactly as before. UserPublic.name maps to the
store's full_name.
"""

from app.schemas.auth import UserPublic
from app.services import user_store
from app.services.user_store import UserRecord


def _to_public(record: UserRecord) -> UserPublic:
    return UserPublic(id=record.id, name=record.full_name, email=record.email, role=record.role)


def authenticate(email: str, password: str) -> UserPublic | None:
    """Return the public user if credentials are valid, else None."""
    record = user_store.authenticate(email, password)
    return _to_public(record) if record else None


def get_by_id(user_id: int) -> UserPublic | None:
    record = user_store.get_by_id(user_id)
    return _to_public(record) if record else None
