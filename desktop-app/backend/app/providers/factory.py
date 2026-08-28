from __future__ import annotations

from ..core.config import settings
from .base import LLMProvider
from .mock import MockProvider
from .openrouter import OpenRouterProvider

_openrouter: OpenRouterProvider | None = None
_mock: MockProvider | None = None


def get_openrouter_provider() -> OpenRouterProvider:
    global _openrouter
    if _openrouter is None:
        _openrouter = OpenRouterProvider()
    return _openrouter


def get_mock_provider() -> MockProvider:
    global _mock
    if _mock is None:
        _mock = MockProvider()
    return _mock


def get_provider(name: str | None = None) -> LLMProvider:
    """Resolve provider by name. Defaults to openrouter when key present, else mock."""
    chosen = name
    if chosen is None:
        chosen = "openrouter" if settings.openrouter_api_key else "mock"
    if chosen == "openrouter":
        return get_openrouter_provider()
    if chosen == "mock":
        return get_mock_provider()
    raise KeyError(f"Unknown provider: {chosen}")


async def aclose_providers() -> None:
    global _openrouter, _mock
    if _openrouter is not None:
        await _openrouter.aclose()
        _openrouter = None
    if _mock is not None:
        await _mock.aclose()
        _mock = None


def reset_providers_for_tests() -> None:
    global _openrouter, _mock
    _openrouter = None
    _mock = None
