from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


def _build_engine(database_url: str) -> Engine:
    """Create an engine with foreign keys actually enforced.

    SQLite defaults foreign_keys to OFF per connection, which silently made
    every ForeignKey and ondelete="CASCADE" in the migrations decorative: a
    CandidateExecution could reference a product that does not exist, and bulk
    delete() statements left orphaned evidence rows behind with no error.
    """
    is_sqlite = database_url.startswith("sqlite")
    new_engine = create_engine(
        database_url,
        connect_args={"check_same_thread": False} if is_sqlite else {},
        future=True,
    )
    if is_sqlite:

        @event.listens_for(new_engine, "connect")
        def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):  # pragma: no cover - driver hook
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
            finally:
                cursor.close()

    return new_engine


engine: Engine = _build_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def configure_engine(database_url: str) -> Engine:
    """Rebind the process-wide engine/session factory (used by tests and create_app)."""
    global engine, SessionLocal
    engine = _build_engine(database_url)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    return engine


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
