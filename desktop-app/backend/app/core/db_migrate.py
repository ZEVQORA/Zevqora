from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from alembic.config import Config
from sqlalchemy.engine.url import make_url

from alembic import command

from .config import settings
from .errors import MigrationError
from .logging import get_logger

logger = get_logger(__name__)

HEAD_REVISION = "0006_evidence_integrity"
BASELINE_REVISION = "0001_desktop_agent_initial"

# Expected MVP / 0001 schema fingerprint for legacy unversioned DBs.
MVP_REQUIRED_TABLES = {
    "products",
    "ai_calls",
    "findings",
    "traces",
    "experiments",
    "implementations",
}
MVP_CRITICAL_COLUMNS: dict[str, set[str]] = {
    "products": {"id", "name", "root_path", "monitoring_enabled", "created_at"},
    "traces": {
        "id",
        "product_id",
        "request_id",
        "cost_usd",
        "candidate_cost_usd",
        "expected_output",
        "candidate_output",
        "protected",
    },
    "experiments": {"id", "product_id", "status", "gates_json", "evidence_version"},
    "implementations": {"id", "product_id", "experiment_id", "status", "worktree_path", "diff_text"},
}


@dataclass(frozen=True)
class MigrationResult:
    action: str
    revision: str | None
    backup_path: str | None = None


def alembic_config(database_url: str | None = None, ini_path: str | Path | None = None) -> Config:
    ini = Path(ini_path or settings.alembic_ini_path).resolve()
    if not ini.exists():
        raise MigrationError(
            f"Alembic config not found at {ini}. Desktop packaging must include alembic.ini and alembic/versions/."
        )
    cfg = Config(str(ini))
    url = database_url or settings.database_url
    cfg.set_main_option("sqlalchemy.url", url)
    # Script location relative to ini file (packaging-safe).
    script_location = (ini.parent / "alembic").resolve()
    if not script_location.exists():
        raise MigrationError(f"Alembic scripts directory not found at {script_location}.")
    cfg.set_main_option("script_location", str(script_location))
    # env.py reads this so programmatic upgrades hit the intended database.
    import os

    os.environ["ZEVQORA_ACTIVE_DATABASE_URL"] = url
    return cfg


def _clear_active_database_url() -> None:
    import os

    os.environ.pop("ZEVQORA_ACTIVE_DATABASE_URL", None)


def sqlite_path_from_url(database_url: str) -> Path | None:
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite":
        return None
    database = url.database
    if not database or database == ":memory:":
        return None
    return Path(database).expanduser().resolve()


def _table_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r[0] for r in rows}


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {r[1] for r in rows}


def is_empty_database(db_path: Path | None, database_url: str) -> bool:
    if database_url.endswith(":memory:") or (db_path is None and "mode=memory" in database_url):
        # Memory DBs are treated as empty for upgrade.
        return True
    if db_path is None:
        return False
    if not db_path.exists() or db_path.stat().st_size == 0:
        return True
    conn = sqlite3.connect(str(db_path))
    try:
        tables = _table_names(conn) - {"sqlite_sequence"}
        return len(tables) == 0
    finally:
        conn.close()


def has_alembic_version(db_path: Path) -> bool:
    if not db_path.exists():
        return False
    conn = sqlite3.connect(str(db_path))
    try:
        tables = _table_names(conn)
        return "alembic_version" in tables
    finally:
        conn.close()


def current_alembic_revision(db_path: Path) -> str | None:
    conn = sqlite3.connect(str(db_path))
    try:
        if "alembic_version" not in _table_names(conn):
            return None
        row = conn.execute("SELECT version_num FROM alembic_version LIMIT 1").fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def matches_mvp_fingerprint(db_path: Path) -> tuple[bool, str]:
    conn = sqlite3.connect(str(db_path))
    try:
        tables = _table_names(conn)
        missing_tables = MVP_REQUIRED_TABLES - tables
        if missing_tables:
            return False, f"Missing required tables: {sorted(missing_tables)}"
        unexpected_core = {"alembic_version"} & tables
        # alembic_version should not be present for unversioned path; ignore if calling fingerprint alone.
        for table, required_cols in MVP_CRITICAL_COLUMNS.items():
            cols = _columns(conn, table)
            missing = required_cols - cols
            if missing:
                return False, f"Table {table} missing columns: {sorted(missing)}"
        # Reject if Trace already has Phase-1-only columns but no alembic_version
        # (ambiguous / partially migrated).
        trace_cols = _columns(conn, "traces")
        phase1_markers = {"cost_source", "pricing_version", "input_hash", "requested_model"}
        if phase1_markers & trace_cols and "alembic_version" not in tables:
            return False, "Database has partial Phase-1 Trace columns without alembic_version"
        _ = unexpected_core
        return True, "ok"
    finally:
        conn.close()


def backup_sqlite_database(db_path: Path, backup_dir: Path | None = None) -> Path:
    target_dir = Path(backup_dir or settings.db_backup_dir).expanduser().resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_path = target_dir / f"zevqora.pre-v0.2.{stamp}.db"
    src = sqlite3.connect(str(db_path))
    try:
        dst = sqlite3.connect(str(backup_path))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    logger.info("database.backup_created", extra={"request_id": str(backup_path)})
    return backup_path


def ensure_schema(
    database_url: str | None = None,
    *,
    ini_path: str | Path | None = None,
    backup_dir: str | Path | None = None,
) -> MigrationResult:
    """Make Alembic authoritative for schema evolution.

    Cases:
    A) empty/new DB → upgrade head
    B) versioned DB → upgrade head
    C) legacy unversioned MVP-compatible → backup, stamp 0001, upgrade head
    D) incompatible unversioned → fail loudly
    """
    url = database_url or settings.database_url
    cfg = alembic_config(url, ini_path=ini_path)
    db_path = sqlite_path_from_url(url)
    try:
        # Non-sqlite: still attempt upgrade head (no fingerprint path).
        if db_path is None:
            command.upgrade(cfg, "head")
            return MigrationResult(action="upgrade_head", revision=HEAD_REVISION)

        if is_empty_database(db_path, url):
            db_path.parent.mkdir(parents=True, exist_ok=True)
            command.upgrade(cfg, "head")
            return MigrationResult(action="new_db_upgrade_head", revision=HEAD_REVISION)

        if has_alembic_version(db_path):
            before = current_alembic_revision(db_path)
            if before != HEAD_REVISION:
                backup = backup_sqlite_database(db_path, Path(backup_dir) if backup_dir else None)
                command.upgrade(cfg, "head")
                after = current_alembic_revision(db_path)
                return MigrationResult(action="upgrade_head", revision=after, backup_path=str(backup))
            command.upgrade(cfg, "head")  # idempotent no-op
            return MigrationResult(action="already_head", revision=HEAD_REVISION)

        # Legacy unversioned DB.
        ok, reason = matches_mvp_fingerprint(db_path)
        if not ok:
            raise MigrationError(
                "Refusing to migrate an unversioned SQLite database that does not match the known "
                f"ZEVQORA MVP schema fingerprint. Reason: {reason}. "
                "The database was not modified. Manual recovery/inspection is required."
            )
        backup = backup_sqlite_database(db_path, Path(backup_dir) if backup_dir else None)
        try:
            command.stamp(cfg, BASELINE_REVISION)
            command.upgrade(cfg, "head")
        except Exception as exc:
            raise MigrationError(
                f"Legacy database migration failed after backup at {backup}. Original error: {exc}"
            ) from exc
        after = current_alembic_revision(db_path)
        return MigrationResult(action="legacy_stamp_and_upgrade", revision=after, backup_path=str(backup))
    finally:
        _clear_active_database_url()
