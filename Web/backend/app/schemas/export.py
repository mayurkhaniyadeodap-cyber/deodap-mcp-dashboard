"""Export API contract — dataset catalog for the Export page."""

from pydantic import BaseModel


class ExportDataset(BaseModel):
    key: str
    label: str
    description: str
    rows: int


class ExportCatalog(BaseModel):
    datasets: list[ExportDataset]
    formats: list[str]
