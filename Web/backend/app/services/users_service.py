"""User management service (admin) — CRUD over the shared user_store.

New members get the default role (Employee) assigned here in the backend; the UI
never sends a role.
"""

from fastapi import HTTPException, status

from app.auth.roles import Role
from app.schemas.users import UserCreate, UserOut, UserUpdate
from app.services import user_store
from app.services.user_store import UserRecord

# Newly added members default to this role (not shown/edited in the UI).
DEFAULT_ROLE = Role.employee


def to_out(record: UserRecord) -> UserOut:
    return UserOut(
        id=record.id,
        full_name=record.full_name,
        email=record.email,
        phone=record.phone,
        role=record.role,
    )


def list_users() -> list[UserOut]:
    return [to_out(u) for u in user_store.list_users()]


def create_user(data: UserCreate) -> UserOut:
    if user_store.email_taken(data.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with this email already exists")
    record = user_store.create_user(
        full_name=data.full_name,
        email=data.email,
        phone=data.phone,
        password=data.password,
        role=DEFAULT_ROLE,
    )
    return to_out(record)


def update_user(user_id: int, data: UserUpdate) -> UserOut:
    record = user_store.get_by_id(user_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user_store.email_taken(data.email, exclude_id=user_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with this email already exists")
    if data.password and len(data.password) < 8:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Password must be at least 8 characters")
    user_store.update_user(
        user_id,
        full_name=data.full_name,
        email=data.email,
        phone=data.phone,
        password=data.password or None,  # empty → keep existing
    )
    return to_out(user_store.get_by_id(user_id))


def delete_user(user_id: int, current_user_id: int) -> None:
    # Prevent an admin from deleting their own account.
    if user_id == current_user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete your own account")
    if user_store.get_by_id(user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    user_store.delete_user(user_id)
