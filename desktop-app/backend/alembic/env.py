from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app import db_models  # noqa: F401 - registers mapped tables
from app.config import settings
from app.db import Base

config = context.config

# Prefer explicit override from ensure_schema / alembic_config so tests and
# desktop installs do not silently migrate the wrong database.
_active_url = os.environ.get("ZEVQORA_ACTIVE_DATABASE_URL") or settings.database_url
config.set_main_option("sqlalchemy.url", _active_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = os.environ.get("ZEVQORA_ACTIVE_DATABASE_URL") or settings.database_url
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section) or {},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
