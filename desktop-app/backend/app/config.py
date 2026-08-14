from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    api_host: str = os.getenv("ZEVQORA_API_HOST", "127.0.0.1")
    api_port: int = int(os.getenv("ZEVQORA_API_PORT", "8000"))
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./zevqora.db")
    openrouter_api_key: str = os.getenv("OPENROUTER_API_KEY", "")
    openrouter_base_url: str = os.getenv(
        "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
    ).rstrip("/")
    openrouter_site_url: str = os.getenv("OPENROUTER_SITE_URL", "https://zevqora.vercel.app")
    agent_model: str = os.getenv("ZEVQORA_AGENT_MODEL", "openrouter/auto")
    agent_max_steps: int = int(os.getenv("ZEVQORA_AGENT_MAX_STEPS", "6"))
    scan_interval_seconds: int = int(os.getenv("ZEVQORA_SCAN_INTERVAL_SECONDS", "20"))
    max_source_file_bytes: int = int(os.getenv("ZEVQORA_MAX_SOURCE_FILE_BYTES", "1000000"))
    worktree_root: str = os.getenv("ZEVQORA_WORKTREE_ROOT", str(Path.home() / ".zevqora" / "worktrees"))


settings = Settings()
