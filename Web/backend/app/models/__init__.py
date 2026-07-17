"""Model package. Importing it registers all tables on Base.metadata (used by
Alembic). Structure only in Phase 1 — nothing here runs against a real DB."""

from app.models.base import Base
from app.models.entities import (
    Bill,
    BillStatusEnum,
    CodRemittance,
    Courier,
    Setting,
    User,
    UserRole,
    WeightRecord,
    Zone,
)

__all__ = [
    "Base",
    "User",
    "UserRole",
    "Courier",
    "Zone",
    "Bill",
    "BillStatusEnum",
    "CodRemittance",
    "WeightRecord",
    "Setting",
]
