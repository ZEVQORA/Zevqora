from __future__ import annotations

from abc import ABC, abstractmethod

from .models import LLMRequest, LLMResponse


class LLMProvider(ABC):
    name: str

    @abstractmethod
    async def complete(self, request: LLMRequest) -> LLMResponse:
        """Execute a single completion request."""

    async def aclose(self) -> None:
        """Release owned resources (HTTP clients, etc.)."""
