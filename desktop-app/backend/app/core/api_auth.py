"""Per-launch shared-secret auth for the local desktop API.

Why this exists
---------------
The backend listens on 127.0.0.1 and the packaged Electron renderer loads from
``file://``, which means it sends ``Origin: null``. "null" therefore has to stay
in the CORS allowlist for the shipped product to work at all — but any web page
the user visits can also obtain a ``null`` origin (a sandboxed iframe, a
``data:`` document). Without a second factor, CORS alone would let a drive-by
page read the user's source code, spend their provider balance, and delete
evidence rows.

The second factor is a high-entropy token minted once per backend launch. The
Electron main process learns it (from the spawn environment it set, or from the
token file the backend writes) and hands it to the renderer over the preload
bridge. A foreign page has neither, so ``Origin: null`` becomes harmless.

The token file is written for the development flow, where the backend is started
by a script rather than by Electron and the two processes have no shared env.
"""

from __future__ import annotations

import os
import secrets
import stat
from contextlib import suppress
from pathlib import Path

from .config import settings
from .logging import get_logger

logger = get_logger(__name__)

API_TOKEN_HEADER = "x-zevqora-token"


def _write_token_file(path: Path, token: str) -> None:
    """Persist the token for the dev flow, readable only by this user."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token, encoding="utf-8")
        # Best effort on Windows, meaningful on POSIX.
        with suppress(OSError):
            path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    except OSError as exc:
        # A missing token file degrades the dev experience but must never take
        # the API down, and must never silently disable auth.
        logger.warning("api_auth.token_file_unwritable", extra={"request_id": str(exc)})


def resolve_api_token() -> str:
    """Return the token this process will require.

    Prefers an explicitly supplied ``ZEVQORA_API_TOKEN`` (how the packaged app
    passes it), otherwise mints a fresh one for this launch.
    """
    token = (settings.api_auth_token or "").strip()
    if not token:
        token = secrets.token_urlsafe(32)
    _write_token_file(Path(settings.api_token_path), token)
    return token


def token_required() -> bool:
    """Whether the API enforces the token.

    Defaults to on. The opt-out exists for running the renderer in a plain
    browser against a local backend, where no preload bridge is available.
    """
    raw = os.getenv("ZEVQORA_API_REQUIRE_TOKEN", "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def token_matches(supplied: str | None, expected: str) -> bool:
    """Constant-time comparison that tolerates a missing header."""
    if not supplied or not expected:
        return False
    return secrets.compare_digest(supplied, expected)
