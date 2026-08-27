import sqlite3
from pathlib import Path

import pytest

from alembic import command
from app.core.db_migrate import (
    BASELINE_REVISION,
    HEAD_REVISION,
    alembic_config,
    current_alembic_revision,
    ensure_schema,
    has_alembic_version,
    matches_mvp_fingerprint,
)
from app.core.errors import MigrationError


def _url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def test_new_empty_db_upgrades_to_head(tmp_path: Path):
    db = tmp_path / "new.db"
    result = ensure_schema(_url(db), backup_dir=tmp_path / "backups")
    assert result.revision == HEAD_REVISION
    assert has_alembic_version(db)
    assert current_alembic_revision(db) == HEAD_REVISION
    conn = sqlite3.connect(str(db))
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(traces)").fetchall()}
    finally:
        conn.close()
    assert "cost_source" in cols
    assert "input_hash" in cols


def test_versioned_db_upgrade_and_idempotent(tmp_path: Path):
    db = tmp_path / "v.db"
    url = _url(db)
    cfg = alembic_config(url)
    command.upgrade(cfg, BASELINE_REVISION)
    assert current_alembic_revision(db) == BASELINE_REVISION
    first = ensure_schema(url, backup_dir=tmp_path / "backups")
    assert first.revision == HEAD_REVISION
    assert first.backup_path is not None
    second = ensure_schema(url, backup_dir=tmp_path / "backups")
    assert second.action == "already_head"
    assert second.backup_path is None


def test_legacy_unversioned_mvp_stamp_and_upgrade(tmp_path: Path):
    db = tmp_path / "legacy.db"
    url = _url(db)
    cfg = alembic_config(url)
    command.upgrade(cfg, BASELINE_REVISION)
    # Remove alembic_version to simulate legacy MVP install.
    conn = sqlite3.connect(str(db))
    try:
        conn.execute(
            "INSERT INTO products (id, name, root_path, monitoring_enabled, created_at) VALUES ('p1','n','/tmp/x',0,'2020-01-01')"
        )
        conn.execute(
            "INSERT INTO traces (id, product_id, request_id, cost_usd, protected) VALUES ('t1','p1','r1',0.5,0)"
        )
        conn.execute("DROP TABLE alembic_version")
        conn.commit()
    finally:
        conn.close()

    ok, reason = matches_mvp_fingerprint(db)
    assert ok, reason
    result = ensure_schema(url, backup_dir=tmp_path / "backups")
    assert result.action == "legacy_stamp_and_upgrade"
    assert result.backup_path is not None
    assert Path(result.backup_path).exists()
    assert current_alembic_revision(db) == HEAD_REVISION

    conn = sqlite3.connect(str(db))
    try:
        row = conn.execute("SELECT cost_usd, cost_source FROM traces WHERE id='t1'").fetchone()
        assert row[0] == 0.5
        assert row[1] is None  # legacy provenance remains unset / honest
        cols = {r[1] for r in conn.execute("PRAGMA table_info(traces)").fetchall()}
    finally:
        conn.close()
    assert "pricing_version" in cols
    conn = sqlite3.connect(str(db))
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    finally:
        conn.close()
    assert "candidate_plans" in tables
    assert "candidate_executions" in tables


def test_phase1_db_upgrades_to_phase2_candidate_tables(tmp_path: Path):
    """Versioned Phase 1 head (0002) upgrades additively to 0003."""
    db = tmp_path / "p1.db"
    url = _url(db)
    cfg = alembic_config(url)
    command.upgrade(cfg, "0002_trace_telemetry_v1")
    conn = sqlite3.connect(str(db))
    try:
        conn.execute(
            "INSERT INTO products (id, name, root_path, monitoring_enabled, created_at) VALUES ('p1','n','/tmp/x',0,'2020-01-01')"
        )
        conn.execute(
            "INSERT INTO traces (id, product_id, request_id, cost_usd, protected) VALUES ('t1','p1','r1',0.5,0)"
        )
        conn.commit()
        tables_before = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    finally:
        conn.close()
    assert "candidate_plans" not in tables_before

    result = ensure_schema(url, backup_dir=tmp_path / "backups")
    assert result.revision == HEAD_REVISION
    conn = sqlite3.connect(str(db))
    try:
        row = conn.execute("SELECT cost_usd FROM traces WHERE id='t1'").fetchone()
        assert row[0] == 0.5
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    finally:
        conn.close()
    assert "candidate_plans" in tables
    assert "candidate_executions" in tables
    second = ensure_schema(url, backup_dir=tmp_path / "backups")
    assert second.action == "already_head"


def test_incompatible_unversioned_schema_refuses(tmp_path: Path):
    db = tmp_path / "bad.db"
    conn = sqlite3.connect(str(db))
    try:
        conn.execute("CREATE TABLE weird (id INTEGER PRIMARY KEY)")
        conn.commit()
    finally:
        conn.close()
    with pytest.raises(MigrationError):
        ensure_schema(_url(db), backup_dir=tmp_path / "backups")
