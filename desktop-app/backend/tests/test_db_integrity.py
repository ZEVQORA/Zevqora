"""Database-level integrity guarantees.

SQLite enforces foreign keys per connection and defaults them OFF. Without the
PRAGMA, every ForeignKey and ondelete="CASCADE" in the migrations is decorative:
rows can reference parents that do not exist and bulk deletes leave orphaned
evidence behind, with no error anywhere.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import text

from app.db import _build_engine


def test_sqlite_foreign_keys_are_enforced(tmp_path: Path):
    engine = _build_engine(f"sqlite:///{(tmp_path / 'fk.db').as_posix()}")
    with engine.connect() as conn:
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_foreign_key_violation_is_actually_rejected(tmp_path: Path):
    """The PRAGMA is only meaningful if a bad reference now raises."""
    engine = _build_engine(f"sqlite:///{(tmp_path / 'fk2.db').as_posix()}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE parent (id TEXT PRIMARY KEY)"))
        conn.execute(
            text("CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE)")
        )

    import sqlalchemy.exc

    raised = False
    try:
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO child (id, parent_id) VALUES ('c1', 'does-not-exist')"))
    except sqlalchemy.exc.IntegrityError:
        raised = True
    assert raised, "orphan insert must be rejected once foreign keys are enforced"


def test_cascade_delete_actually_cascades(tmp_path: Path):
    engine = _build_engine(f"sqlite:///{(tmp_path / 'fk3.db').as_posix()}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE parent (id TEXT PRIMARY KEY)"))
        conn.execute(
            text("CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE)")
        )
        conn.execute(text("INSERT INTO parent (id) VALUES ('p1')"))
        conn.execute(text("INSERT INTO child (id, parent_id) VALUES ('c1', 'p1')"))
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM parent WHERE id = 'p1'"))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM child")).scalar() == 0
