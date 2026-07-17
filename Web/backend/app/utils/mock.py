"""Loader for the mock JSON fixtures.

The mock data lives in app/database/mock/*.json and is loaded here. Services
call load_mock() and shape the result. Phase 2 replaces the service internals
(e.g. query a DB) — this loader and the JSON go away then.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

MOCK_DIR = Path(__file__).resolve().parent.parent / "database" / "mock"


@lru_cache
def load_mock(name: str) -> Any:
    """Read and parse a mock JSON file (cached). Callers must treat the result
    as read-only (build new lists rather than mutating in place)."""
    return json.loads((MOCK_DIR / name).read_text(encoding="utf-8"))
