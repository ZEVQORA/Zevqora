from __future__ import annotations

from ..core import platform
from ..core.config import settings
from .base import LLMProvider
from .mock import MockProvider
from .openrouter import OpenRouterProvider

_openrouter: OpenRouterProvider | None = None
_platform: OpenRouterProvider | None = None
_platform_key: str | None = None
_mock: MockProvider | None = None


def get_local_openrouter_provider() -> OpenRouterProvider:
    """OpenRouter with the device-local key (BYOK). Raises on use when no key is set."""
    global _openrouter
    if _openrouter is None:
        _openrouter = OpenRouterProvider(via="direct")
    return _openrouter


def get_platform_provider() -> OpenRouterProvider:
    """OpenRouter-compatible provider routed through the ZEVQORA platform proxy.

    Rebuilt whenever the access token or the active workspace/project changes so
    a refreshed session is picked up without a restart.
    """
    global _platform, _platform_key
    session = platform.get_session()
    if session is None:
        # An unauthenticated platform provider fails at request time with a
        # clear message rather than at construction time.
        return OpenRouterProvider(api_key="", base_url=settings.openrouter_base_url, via="platform")
    key = f"{session.token_fingerprint}:{session.workspace_id}:{session.project_id}:{session.base_url}"
    if _platform is None or _platform_key != key:
        _platform = OpenRouterProvider(
            api_key=session.access_token,
            base_url=session.completions_base_url,
            site_url=session.base_url,
            extra_headers=session.context_headers(),
            via="platform",
        )
        _platform_key = key
    return _platform


def get_openrouter_provider() -> OpenRouterProvider:
    """The OpenRouter path in effect: local key first, then the platform proxy."""
    if settings.openrouter_api_key:
        return get_local_openrouter_provider()
    if platform.session_active():
        return get_platform_provider()
    return get_local_openrouter_provider()


def get_mock_provider() -> MockProvider:
    global _mock
    if _mock is None:
        _mock = MockProvider()
    return _mock


def get_provider(name: str | None = None) -> LLMProvider:
    """Resolve provider by name. Defaults to OpenRouter when any credential path exists, else mock."""
    chosen = name
    if chosen is None:
        chosen = "openrouter" if platform.provider_available() else "mock"
    if chosen == "openrouter":
        return get_openrouter_provider()
    if chosen == "mock":
        return get_mock_provider()
    raise KeyError(f"Unknown provider: {chosen}")


async def aclose_providers() -> None:
    global _openrouter, _platform, _platform_key, _mock
    if _openrouter is not None:
        await _openrouter.aclose()
        _openrouter = None
    if _platform is not None:
        await _platform.aclose()
        _platform = None
        _platform_key = None
    if _mock is not None:
        await _mock.aclose()
        _mock = None


def reset_platform_provider() -> None:
    """Drop the cached platform provider so the next call rebuilds it from the session."""
    global _platform, _platform_key
    _platform = None
    _platform_key = None


def reset_providers_for_tests() -> None:
    global _openrouter, _platform, _platform_key, _mock
    _openrouter = None
    _platform = None
    _platform_key = None
    _mock = None
