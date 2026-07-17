"""Profile routes — the currently authenticated user."""

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.schemas.auth import UserPublic
from app.schemas.users import ChangePasswordRequest, MessageResponse, ProfileUpdate, UserOut
from app.services import profile_service

router = APIRouter(tags=["profile"], dependencies=[Depends(get_current_user)])


@router.get("/profile", response_model=UserOut)
def get_profile(current: UserPublic = Depends(get_current_user)) -> UserOut:
    return profile_service.get_profile(current.id)


@router.patch("/profile", response_model=UserOut)
def update_profile(
    body: ProfileUpdate, current: UserPublic = Depends(get_current_user)
) -> UserOut:
    return profile_service.update_profile(current.id, body)


@router.post("/profile/change-password", response_model=MessageResponse)
def change_password(
    body: ChangePasswordRequest, current: UserPublic = Depends(get_current_user)
) -> MessageResponse:
    profile_service.change_password(current.id, body)
    return MessageResponse(ok=True, message="Password updated")
