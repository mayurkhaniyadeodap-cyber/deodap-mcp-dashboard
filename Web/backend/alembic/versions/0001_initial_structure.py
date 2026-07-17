"""initial schema structure

Revision ID: 0001_initial_structure
Revises:
Create Date: 2026-07-13

Phase 1: this migration defines the intended schema. It is NOT run against a
real database in Phase 1 — it exists for structure and Phase-2 readiness.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial_structure"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ROLE = sa.Enum("admin", "operations", "finance", "viewer", name="userrole")
_BILL_STATUS = sa.Enum("delivered", "in_transit", "pending", "rto", "discrepancy", name="billstatusenum")


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("role", _ROLE, nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "couriers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_couriers_code", "couriers", ["code"])

    op.create_table(
        "zones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("region", sa.String(length=64), nullable=True),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "bills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("awb", sa.String(length=32), nullable=False),
        sa.Column("courier_id", sa.Integer(), sa.ForeignKey("couriers.id"), nullable=False),
        sa.Column("ship_date", sa.Date(), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=False),
        sa.Column("zone", sa.String(length=64), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("cod_amount", sa.Float(), nullable=False),
        sa.Column("status", _BILL_STATUS, nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("awb"),
    )
    op.create_index("ix_bills_awb", "bills", ["awb"])
    op.create_index("ix_bills_courier_id", "bills", ["courier_id"])
    op.create_index("ix_bills_ship_date", "bills", ["ship_date"])
    op.create_index("ix_bills_zone", "bills", ["zone"])
    op.create_index("ix_bills_status", "bills", ["status"])

    op.create_table(
        "cod_remittance",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("courier_id", sa.Integer(), sa.ForeignKey("couriers.id"), nullable=False),
        sa.Column("period", sa.String(length=32), nullable=False),
        sa.Column("collected", sa.Float(), nullable=False),
        sa.Column("remitted", sa.Float(), nullable=False),
        sa.Column("pending", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
    )
    op.create_index("ix_cod_remittance_courier_id", "cod_remittance", ["courier_id"])

    op.create_table(
        "weight_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bill_id", sa.Integer(), sa.ForeignKey("bills.id"), nullable=False),
        sa.Column("actual_kg", sa.Float(), nullable=False),
        sa.Column("charged_kg", sa.Float(), nullable=False),
        sa.Column("variance", sa.Float(), nullable=False),
    )
    op.create_index("ix_weight_records_bill_id", "weight_records", ["bill_id"])

    op.create_table(
        "settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value_json", sa.String(), nullable=False),
        sa.UniqueConstraint("key"),
    )
    op.create_index("ix_settings_key", "settings", ["key"])


def downgrade() -> None:
    op.drop_table("settings")
    op.drop_table("weight_records")
    op.drop_table("cod_remittance")
    op.drop_table("bills")
    op.drop_table("zones")
    op.drop_table("couriers")
    op.drop_table("users")
    _BILL_STATUS.drop(op.get_bind(), checkfirst=True)
    _ROLE.drop(op.get_bind(), checkfirst=True)
