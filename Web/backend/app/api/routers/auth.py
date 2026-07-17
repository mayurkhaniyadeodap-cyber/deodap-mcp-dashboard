"""Auth routes: POST /login and GET /me."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user
from app.core.security import create_access_token
from app.schemas.auth import LoginRequest, TokenResponse, UserPublic
from app.services import auth_service

router = APIRouter(tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest) -> TokenResponse:
    user = auth_service.authenticate(body.email, body.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    token = create_access_token(
        subject=str(user.id),
        claims={"role": user.role.value, "email": user.email, "name": user.name},
    )
    return TokenResponse(access_token=token, user=user)


@router.get("/me", response_model=UserPublic)
def me(current: UserPublic = Depends(get_current_user)) -> UserPublic:
    return current
