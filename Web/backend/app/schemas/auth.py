"""Auth API contract — these Pydantic models define the /login and /me shapes
that surface in OpenAPI and drive the generated frontend types.
"""

from pydantic import BaseModel, EmailStr, Field

from app.auth.roles import Role


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class UserPublic(BaseModel):
    """The safe, client-facing representation of a user (no password)."""

    id: int
    name: str
    email: EmailStr
    role: Role


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic
