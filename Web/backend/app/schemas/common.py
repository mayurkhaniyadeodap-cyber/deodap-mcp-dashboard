"""Shared schema building blocks."""

from typing import Generic, Literal, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """Generic server-side pagination envelope. Drives the frontend DataTable
    pattern so it is ready for real, paginated data in Phase 2."""

    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    # Data provenance for the UI badge (never faked as "live"):
    #   "live"        → served from the Ship MCP.
    #   "sample"      → committed demo rows, shown only where the MCP can't serve the
    #                   request (free-text search / arbitrary sort), or in dev fixtures.
    #   "unavailable" → the live fetch failed → empty result (no fabricated rows).
    source: Literal["live", "sample", "unavailable"] = "live"
