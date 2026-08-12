"""SQLAlchemy 2.0 models — STRUCTURE ONLY (Phase 1).

These define the intended relational schema and back the single Alembic
migration. They are NOT used at runtime in Phase 1 (services read mock JSON),
and no code connects to a real database. Phase 2 wires services + get_db to
these tables.
"""

from datetime import date, datetime
from enum import Enum

from sqlalchemy import Boolean, Date, DateTime, Enum as SAEnum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class UserRole(str, Enum):
    admin = "admin"
    operations = "operations"
    finance = "finance"
    viewer = "viewer"


class BillStatusEnum(str, Enum):
    delivered = "delivered"
    in_transit = "in_transit"
    pending = "pending"
    rto = "rto"
    discrepancy = "discrepancy"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    # Stored as the Role string value ("admin" | "employee"); the app's Role enum
    # (app.auth.roles) is the source of truth, so we avoid a DB-side enum that would
    # drift from it.
    role: Mapped[str] = mapped_column(String(32), default="employee")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Courier(Base):
    __tablename__ = "couriers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    bills: Mapped[list["Bill"]] = relationship(back_populates="courier")
    cod_remittances: Mapped[list["CodRemittance"]] = relationship(back_populates="courier")


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    region: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Bill(Base):
    __tablename__ = "bills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    awb: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    courier_id: Mapped[int] = mapped_column(ForeignKey("couriers.id"), index=True)
    ship_date: Mapped[date] = mapped_column(Date, index=True)
    weight_kg: Mapped[float] = mapped_column(Float)
    zone: Mapped[str] = mapped_column(String(64), index=True)
    amount: Mapped[float] = mapped_column(Float)
    cod_amount: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[BillStatusEnum] = mapped_column(SAEnum(BillStatusEnum), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    courier: Mapped["Courier"] = relationship(back_populates="bills")
    weight_record: Mapped["WeightRecord"] = relationship(back_populates="bill", uselist=False)


class CodRemittance(Base):
    __tablename__ = "cod_remittance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    courier_id: Mapped[int] = mapped_column(ForeignKey("couriers.id"), index=True)
    period: Mapped[str] = mapped_column(String(32))
    collected: Mapped[float] = mapped_column(Float, default=0.0)
    remitted: Mapped[float] = mapped_column(Float, default=0.0)
    pending: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(32))

    courier: Mapped["Courier"] = relationship(back_populates="cod_remittances")


class WeightRecord(Base):
    __tablename__ = "weight_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("bills.id"), index=True)
    actual_kg: Mapped[float] = mapped_column(Float)
    charged_kg: Mapped[float] = mapped_column(Float)
    variance: Mapped[float] = mapped_column(Float, default=0.0)

    bill: Mapped["Bill"] = relationship(back_populates="weight_record")


class Setting(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    value_json: Mapped[str] = mapped_column(String)


class ExportHistory(Base):
    """One row per export download. Metadata ONLY — the actual CSV/XLSX bytes live on
    disk at `file_path` (never in the DB). A re-download reads that file directly, so
    it never re-calls MCP / re-generates anything."""

    __tablename__ = "export_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset: Mapped[str] = mapped_column(String(64))
    fmt: Mapped[str] = mapped_column(String(8))
    date_from: Mapped[str | None] = mapped_column(String(10), nullable=True)
    date_to: Mapped[str | None] = mapped_column(String(10), nullable=True)
    record_count: Mapped[int] = mapped_column(Integer, default=0)
    filename: Mapped[str] = mapped_column(String(255))
    media_type: Mapped[str] = mapped_column(String(128), default="")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="completed")  # completed | failed
    error: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
