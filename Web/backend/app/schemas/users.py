"""Users + profile API contract (Phase 2 additions)."""

from pydantic import BaseModel, EmailStr, Field

from app.auth.roles import Role


class UserOut(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    phone: str
    role: Role


class UserCreate(BaseModel):
    full_name: str = Field(min_length=1)
    email: EmailStr
    phone: str = Field(min_length=1)
    password: str = Field(min_length=8)


class UserUpdate(BaseModel):
    full_name: str = Field(min_length=1)
    email: EmailStr
    phone: str = Field(min_length=1)
    # Optional on edit: empty/None keeps the existing password (validated in service).
    password: str | None = None


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=1)
    email: EmailStr
    phone: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


class MessageResponse(BaseModel):
    ok: bool = True
    message: str = ""
