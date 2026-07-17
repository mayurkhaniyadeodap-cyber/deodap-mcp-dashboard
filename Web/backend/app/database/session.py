"""SQLAlchemy engine + session factory (structure only in Phase 1).

Defined for completeness and Phase-2 readiness. Nothing in Phase 1 imports
SessionLocal or connects — services read mock JSON, and api.deps.get_db yields
None. Phase 2 switches get_db to yield a real Session from here.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

# check_same_thread only matters for SQLite; harmless default here.
_connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_engine(settings.database_url, connect_args=_connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
