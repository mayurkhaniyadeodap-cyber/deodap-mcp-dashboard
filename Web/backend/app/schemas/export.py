"""Export API contract — dataset catalog + export history for the Export page."""

from datetime import datetime

from pydantic import BaseModel


class ExportDataset(BaseModel):
    key: str
    label: str
    description: str
    rows: int


class ExportCatalog(BaseModel):
    datasets: list[ExportDataset]
    formats: list[str]


class ExportHistoryOut(BaseModel):
    id: int
    dataset: str
    fmt: str
    date_from: str | None
    date_to: str | None
    record_count: int
    filename: str
    media_type: str
    size_bytes: int
    status: str  # "completed" | "failed"
    error: str | None
    created_at: datetime


class ExportHistoryList(BaseModel):
    items: list[ExportHistoryOut]
