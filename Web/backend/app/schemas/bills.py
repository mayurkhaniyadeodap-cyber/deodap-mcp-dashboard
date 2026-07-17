"""Bills API contract."""

from datetime import date
from enum import Enum

from pydantic import BaseModel


class BillStatus(str, Enum):
    delivered = "delivered"
    in_transit = "in_transit"
    pending = "pending"
    rto = "rto"
    discrepancy = "discrepancy"


class Bill(BaseModel):
    id: int
    awb: str
    courier: str
    date: date
    weight: float
    zone: str
    amount: float
    cod: float
    status: BillStatus
