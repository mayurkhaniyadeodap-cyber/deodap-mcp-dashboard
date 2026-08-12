"""Export history — metadata in SQLite, file BYTES on disk.

Each completed export writes its CSV/XLSX to disk (EXPORT_DIR) and records a small
metadata row. A later re-download reads that file straight from disk — it NEVER
re-calls MCP, re-fetches, or re-generates. Failed exports are recorded with a
`failed` status + error (never shown as completed). Old entries are pruned.
"""

import logging
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from app.database.session import SessionLocal
from app.models.entities import ExportHistory
from app.schemas.export import ExportHistoryOut

logger = logging.getLogger("live")

# File store: the persistent /data volume in prod, else the backend package root.
# Metadata (DB) is separate from these bytes (requirement 8).
_data_dir = Path("/data")
EXPORT_DIR: Path = (_data_dir / "exports") if _data_dir.is_dir() else (Path(__file__).resolve().parents[2] / "exports")
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

_RETENTION = 200  # keep the most-recent N exports (rows + files); prune the rest.


@contextmanager
def _session():
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def _to_out(r: ExportHistory) -> ExportHistoryOut:
    return ExportHistoryOut(
        id=r.id, dataset=r.dataset, fmt=r.fmt, date_from=r.date_from, date_to=r.date_to,
        record_count=r.record_count, filename=r.filename, media_type=r.media_type,
        size_bytes=r.size_bytes, status=r.status, error=r.error, created_at=r.created_at,
    )


def record_success(
    *, dataset: str, fmt: str, date_from: str | None, date_to: str | None,
    filename: str, media_type: str, content: bytes, record_count: int,
) -> ExportHistoryOut:
    """Persist the generated file to disk + a `completed` metadata row."""
    path = EXPORT_DIR / filename
    path.write_bytes(content)
    with _session() as s:
        row = ExportHistory(
            dataset=dataset, fmt=fmt, date_from=date_from, date_to=date_to,
            record_count=record_count, filename=filename, media_type=media_type,
            size_bytes=len(content), file_path=str(path), status="completed", error=None,
            created_at=datetime.utcnow(),
        )
        s.add(row)
        s.flush()
        out = _to_out(row)
    _prune()
    return out


def record_failure(
    *, dataset: str, fmt: str, date_from: str | None, date_to: str | None,
    filename: str, error: str,
) -> ExportHistoryOut:
    """Record a `failed` export (no file). Never shown as completed."""
    with _session() as s:
        row = ExportHistory(
            dataset=dataset, fmt=fmt, date_from=date_from, date_to=date_to,
            record_count=0, filename=filename, media_type="", size_bytes=0,
            file_path=None, status="failed", error=(error or "Export failed")[:500],
            created_at=datetime.utcnow(),
        )
        s.add(row)
        s.flush()
        out = _to_out(row)
    return out


def list_recent(limit: int = 50) -> list[ExportHistoryOut]:
    with _session() as s:
        rows = s.scalars(
            select(ExportHistory).order_by(ExportHistory.id.desc()).limit(limit)
        ).all()
        return [_to_out(r) for r in rows]


def get_file(export_id: int) -> tuple[bytes, str, str] | None:
    """Return (bytes, media_type, filename) for a completed export whose file still
    exists — reading DISK ONLY (no MCP, no regeneration). None → 'File unavailable'."""
    with _session() as s:
        row = s.get(ExportHistory, export_id)
        if row is None or row.status != "completed" or not row.file_path:
            return None
        path = Path(row.file_path)
        if not path.exists():
            return None
        return path.read_bytes(), row.media_type, row.filename


def _prune() -> None:
    """Keep the most-recent _RETENTION entries; delete older rows + their files."""
    with _session() as s:
        stale_ids = s.scalars(
            select(ExportHistory.id).order_by(ExportHistory.id.desc()).offset(_RETENTION)
        ).all()
        if not stale_ids:
            return
        for r in s.scalars(select(ExportHistory).where(ExportHistory.id.in_(stale_ids))).all():
            if r.file_path:
                try:
                    Path(r.file_path).unlink(missing_ok=True)
                except OSError:
                    logger.warning("export-history: could not remove pruned file %s", r.file_path)
            s.delete(r)
