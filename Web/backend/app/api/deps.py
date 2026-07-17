"""Shared FastAPI dependencies: DB session (placeholder), current user, role guard,
and an optional from/to date-range query."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.roles import Role
from app.core.security import JWTError, decode_access_token
from app.schemas.auth import UserPublic
from app.services import auth_service


@dataclass
class DateRange:
    """Optional ISO (YYYY-MM-DD) date-range, both fields may be None."""

    date_from: str | None = None
    date_to: str | None = None


def date_range_params(
    date_from: str | None = Query(default=None, alias="from", description="Start date YYYY-MM-DD"),
    date_to: str | None = Query(default=None, alias="to", description="End date YYYY-MM-DD"),
) -> DateRange:
    """Shared optional `?from=&to=` query params (adds them to every endpoint that
    depends on it without touching response schemas)."""
    return DateRange(date_from=date_from, date_to=date_to)

# HTTPBearer surfaces the "Authorize" button in /docs. auto_error=False lets us
# raise our own uniform 401 instead of Starlette's default.
_bearer = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_db() -> Iterator[None]:
    """Placeholder DB dependency (structure only in Phase 1).

    Phase 2: yield a real SQLAlchemy Session from app.database.session.
    """
    yield None


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserPublic:
    if creds is None or not creds.credentials:
        raise _UNAUTHORIZED
    try:
        payload = decode_access_token(creds.credentials)
    except JWTError as exc:
        raise _UNAUTHORIZED from exc

    subject = payload.get("sub")
    if subject is None:
        raise _UNAUTHORIZED
    user = auth_service.get_by_id(int(subject))
    if user is None:
        raise _UNAUTHORIZED
    return user


def require_role(*allowed: Role) -> Callable[..., UserPublic]:
    """Dependency factory: 403 unless the current user has one of `allowed` roles."""

    def _guard(user: UserPublic = Depends(get_current_user)) -> UserPublic:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return _guard
