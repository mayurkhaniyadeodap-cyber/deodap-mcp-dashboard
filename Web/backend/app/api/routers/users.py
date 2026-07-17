"""User management routes (Admin only)."""

from fastapi import APIRouter, Depends, status

from app.api.deps import require_role
from app.auth.roles import Role
from app.schemas.auth import UserPublic
from app.schemas.users import MessageResponse, UserCreate, UserOut, UserUpdate
from app.services import users_service

# All routes require the admin role.
router = APIRouter(tags=["users"], dependencies=[Depends(require_role(Role.admin))])


@router.get("/users", response_model=list[UserOut])
def list_users() -> list[UserOut]:
    return users_service.list_users()


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate) -> UserOut:
    return users_service.create_user(body)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate) -> UserOut:
    return users_service.update_user(user_id, body)


@router.delete("/users/{user_id}", response_model=MessageResponse)
def delete_user(
    user_id: int, current: UserPublic = Depends(require_role(Role.admin))
) -> MessageResponse:
    users_service.delete_user(user_id, current_user_id=current.id)
    return MessageResponse(ok=True, message="User deleted")
