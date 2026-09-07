"""Platform session — the local engine's link to the ZEVQORA account service.

ZEVQORA Desktop signs in against the same Supabase account as the website. The
Electron main process holds the session tokens and pushes the current access
token (plus the active workspace/project) into this process over the local,
token-protected API. With a session present and no device-local provider key,
the engine routes model calls through the platform proxy:

    engine → Bearer <access token> → {platform}/api/platform/chat/completions
           → authorization → plan/credit check → rate limit → OpenRouter

The provider credential therefore never exists on the device. The access token
is kept in memory only, never written to disk or logs, and only its fingerprint
is ever reported.
"""

from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlparse

from .config import settings

# Cheap, widely available candidates the planner may propose when platform
# compute (or a local key) is present. Spend is still bounded by the plan budget
# and the per-experiment cap; this only widens the allowlist beyond the offline
# mock. Rates come from the platform pricing snapshot at session time.
DEFAULT_PLATFORM_CANDIDATE_MODELS: tuple[str, ...] = (
    "openai/gpt-4o-mini",
    "openai/gpt-4.1-mini",
    "openai/gpt-4.1-nano",
    "anthropic/claude-3.5-haiku",
    "google/gemini-2.5-flash",
    "google/gemini-2.5-flash-lite",
    "deepseek/deepseek-chat",
    "mistralai/mistral-small",
)

_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


@dataclass(frozen=True)
class PlatformSession:
    base_url: str
    access_token: str
    user_id: str | None
    email: str | None
    workspace_id: str | None
    project_id: str | None
    plan: str | None
    updated_at: datetime

    @property
    def token_fingerprint(self) -> str:
        return hashlib.sha256(self.access_token.encode("utf-8")).hexdigest()[:12]

    @property
    def completions_base_url(self) -> str:
        return f"{self.base_url}/api/platform"

    def context_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self.workspace_id:
            headers["X-Zevqora-Workspace"] = self.workspace_id
        if self.project_id:
            headers["X-Zevqora-Project"] = self.project_id
        return headers

    def redacted(self) -> dict[str, object]:
        """Safe to serialize: never includes the token."""
        return {
            "base_url": self.base_url,
            "user_id": self.user_id,
            "email": self.email,
            "workspace_id": self.workspace_id,
            "project_id": self.project_id,
            "plan": self.plan,
            "token_fingerprint": self.token_fingerprint,
            "updated_at": self.updated_at.isoformat(),
        }


_lock = threading.Lock()
_session: PlatformSession | None = None


def validate_base_url(url: str) -> str:
    cleaned = str(url or "").strip().rstrip("/")
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        raise ValueError("Platform URL must be an absolute http(s) URL.")
    if parsed.scheme == "http" and parsed.hostname not in _LOCAL_HOSTS:
        raise ValueError("Platform URL must use HTTPS.")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("Platform URL must be an origin without a path.")
    return f"{parsed.scheme}://{parsed.netloc}"


def set_session(
    *,
    base_url: str,
    access_token: str,
    user_id: str | None = None,
    email: str | None = None,
    workspace_id: str | None = None,
    project_id: str | None = None,
    plan: str | None = None,
) -> PlatformSession:
    global _session
    token = str(access_token or "").strip()
    if len(token) < 20:
        raise ValueError("Access token is missing.")
    session = PlatformSession(
        base_url=validate_base_url(base_url),
        access_token=token,
        user_id=(user_id or None),
        email=(email or None),
        workspace_id=(workspace_id or None),
        project_id=(project_id or None),
        plan=(plan or None),
        updated_at=datetime.now(UTC),
    )
    with _lock:
        _session = session
    return session


def clear_session() -> None:
    global _session
    with _lock:
        _session = None


def get_session() -> PlatformSession | None:
    with _lock:
        return _session


def session_active() -> bool:
    return get_session() is not None


def provider_mode() -> str:
    """Which credential path model calls will take: local_key, platform or none."""
    if settings.openrouter_api_key:
        return "local_key"
    if session_active():
        return "platform"
    return "none"


def provider_available() -> bool:
    return provider_mode() != "none"


def allowed_platform_candidate_models() -> set[str]:
    """Extra candidate models unlocked when a real provider path exists."""
    if not provider_available():
        return set()
    return set(DEFAULT_PLATFORM_CANDIDATE_MODELS)
