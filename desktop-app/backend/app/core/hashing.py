from __future__ import annotations

import hashlib
import json
from typing import Any


def sha256_text(value: str | None) -> str | None:
    """Stable SHA-256 of UTF-8 text. Empty/whitespace-only → None."""
    if value is None:
        return None
    if not value.strip():
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_json(value: Any) -> str:
    """Stable SHA-256 of canonical JSON (sorted keys, compact separators)."""
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
