"""Profile service — the currently authenticated user's own record (by id)."""

from fastapi import HTTPException, status

from app.schemas.users import ChangePasswordRequest, ProfileUpdate, UserOut
from app.services import user_store
from app.services.users_service import to_out


def get_profile(user_id: int) -> UserOut:
    record = user_store.get_by_id(user_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return to_out(record)


def update_profile(user_id: int, data: ProfileUpdate) -> UserOut:
    record = user_store.get_by_id(user_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user_store.email_taken(data.email, exclude_id=user_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with this email already exists")
    user_store.update_user(user_id, full_name=data.full_name, email=data.email, phone=data.phone)
    return to_out(user_store.get_by_id(user_id))


def change_password(user_id: int, data: ChangePasswordRequest) -> None:
    record = user_store.get_by_id(user_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if not user_store.verify(record, data.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if data.new_password == data.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be different from the current password")
    user_store.set_password(record, data.new_password)
