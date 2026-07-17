"""Shared schema building blocks."""

from typing import Generic, TypeVar

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
