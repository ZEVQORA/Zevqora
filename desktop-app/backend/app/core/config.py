from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[2]


@dataclass
class Settings:
    api_host: str = os.getenv("ZEVQORA_API_HOST", "127.0.0.1")
    api_port: int = int(os.getenv("ZEVQORA_API_PORT", "8000"))
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./zevqora.db")

    openrouter_api_key: str = os.getenv("OPENROUTER_API_KEY", "")
    openrouter_base_url: str = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
    openrouter_site_url: str = os.getenv("OPENROUTER_SITE_URL", "https://zevqora.vercel.app")
    agent_model: str = os.getenv("ZEVQORA_AGENT_MODEL", "openrouter/auto")
    agent_max_steps: int = int(os.getenv("ZEVQORA_AGENT_MAX_STEPS", "6"))

    scan_interval_seconds: int = int(os.getenv("ZEVQORA_SCAN_INTERVAL_SECONDS", "20"))
    max_source_file_bytes: int = int(os.getenv("ZEVQORA_MAX_SOURCE_FILE_BYTES", "1000000"))
    worktree_root: str = os.getenv("ZEVQORA_WORKTREE_ROOT", str(Path.home() / ".zevqora" / "worktrees"))

    provider_timeout_seconds: float = float(os.getenv("ZEVQORA_PROVIDER_TIMEOUT_SECONDS", "90"))
    provider_max_retries: int = int(os.getenv("ZEVQORA_PROVIDER_MAX_RETRIES", "2"))
    max_raw_metadata_bytes: int = int(os.getenv("ZEVQORA_MAX_RAW_METADATA_BYTES", "4096"))

    pricing_snapshot_path: str = os.getenv(
        "ZEVQORA_PRICING_SNAPSHOT",
        str(_backend_root() / "app" / "providers" / "data" / "pricing_v1.json"),
    )

    subprocess_timeout_seconds: float = float(os.getenv("ZEVQORA_SUBPROCESS_TIMEOUT_SECONDS", "180"))
    subprocess_max_output_bytes: int = int(os.getenv("ZEVQORA_SUBPROCESS_MAX_OUTPUT_BYTES", "20000"))

    alembic_ini_path: str = os.getenv(
        "ZEVQORA_ALEMBIC_INI",
        str(_backend_root() / "alembic.ini"),
    )
    db_backup_dir: str = os.getenv(
        "ZEVQORA_DB_BACKUP_DIR",
        str(Path.home() / ".zevqora" / "db-backups"),
    )

    # Phase 2 — candidate execution (conservative defaults; no agent-invented model spend)
    candidate_models: tuple[str, ...] = tuple(
        m.strip() for m in os.getenv("ZEVQORA_CANDIDATE_MODELS", "mock/test-model").split(",") if m.strip()
    )
    max_experiment_cost_usd: float = float(os.getenv("ZEVQORA_MAX_EXPERIMENT_COST_USD", "0.50"))
    max_candidate_samples: int = int(os.getenv("ZEVQORA_MAX_CANDIDATE_SAMPLES", "10"))
    max_candidate_concurrency: int = int(os.getenv("ZEVQORA_MAX_CANDIDATE_CONCURRENCY", "2"))


settings = Settings()
