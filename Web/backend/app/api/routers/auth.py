"""Auth routes: POST /login, POST /logout and GET /me."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.api.deps import get_current_user
from app.core.base_path import public_prefix
from app.core.config import settings
from app.core.security import create_access_token
from app.schemas.auth import LoginRequest, TokenResponse, UserPublic
from app.services import auth_service

router = APIRouter(tags=["auth"])


def _cookie_path(request: Request) -> str:
    """The session cookie is scoped to this deployment's API only ("/courier-billing/api" behind
    the care.deodap.info sub-path, "/api" on a domain of its own): the browser never sends it
    to other apps on a shared domain, and page scripts can't read it (httpOnly)."""
    return f"{public_prefix(request.headers)}/api"


def _is_https(request: Request) -> bool:
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request, response: Response) -> TokenResponse:
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
    response.set_cookie(
        settings.auth_cookie_name, token,
        max_age=settings.access_token_expire_minutes * 60,
        path=_cookie_path(request), httponly=True, secure=_is_https(request), samesite="strict",
    )
    # The token stays in the body for API clients and scripts; the web app ignores it and
    # relies on the httpOnly cookie, so nothing readable by page scripts holds a credential.
    return TokenResponse(access_token=token, user=user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response) -> Response:
    """End the cookie session (idempotent; needs no login)."""
    response.delete_cookie(
        settings.auth_cookie_name, path=_cookie_path(request),
        httponly=True, secure=_is_https(request), samesite="strict",
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserPublic)
def me(current: UserPublic = Depends(get_current_user)) -> UserPublic:
    return current
