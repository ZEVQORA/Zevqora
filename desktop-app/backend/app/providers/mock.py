from __future__ import annotations

import asyncio
import hashlib
import json
import time

from .base import LLMProvider
from .models import (
    CostBreakdown,
    CostSource,
    FinishReason,
    LLMRequest,
    LLMResponse,
    LLMUsage,
    ToolCall,
)
from .pricing import get_pricing_snapshot


class MockProvider(LLMProvider):
    """Deterministic provider for tests. Never treat as real benchmark evidence."""

    name = "mock"

    def __init__(
        self,
        *,
        responses: dict[str, str] | None = None,
        default_content: str = "mock response",
        latency_ms: float = 1.0,
        tool_response: list[ToolCall] | None = None,
        usage: LLMUsage | None = None,
        provider_cost_usd: float | None = 0.0,
        raise_error: Exception | None = None,
        cost_override: CostBreakdown | None = None,
    ) -> None:
        self.responses = responses or {}
        self.default_content = default_content
        self.latency_ms = latency_ms
        self.tool_response = tool_response
        self.usage = usage or LLMUsage(input_tokens=10, output_tokens=5, total_tokens=15)
        self.provider_cost_usd = provider_cost_usd
        self.raise_error = raise_error
        self.cost_override = cost_override
        self.pricing = get_pricing_snapshot()
        self.calls: list[LLMRequest] = []

    def _content_for(self, request: LLMRequest) -> str:
        last_user = next((m.content for m in reversed(request.messages) if m.role == "user" and m.content), "")
        if last_user and last_user in self.responses:
            return self.responses[last_user]
        return self.default_content

    @staticmethod
    def _request_key(request: LLMRequest) -> str:
        payload = json.dumps(
            {"model": request.model, "messages": [m.model_dump() for m in request.messages]},
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    async def complete(self, request: LLMRequest) -> LLMResponse:
        self.calls.append(request)
        if self.raise_error is not None:
            raise self.raise_error
        started = time.perf_counter()
        if self.latency_ms > 0:
            await asyncio.sleep(min(self.latency_ms / 1000.0, 0.02))
        elapsed = (time.perf_counter() - started) * 1000.0

        tool_calls = list(self.tool_response or [])
        content = None if tool_calls else self._content_for(request)
        if self.cost_override is not None:
            cost = self.cost_override
        else:
            cost = self.pricing.resolve_cost(
                provider=self.name,
                model=request.model if self.pricing.has_verified_rates(request.model) else "mock/test-model",
                usage=self.usage,
                provider_cost_usd=self.provider_cost_usd,
            )
            # Keep mock provenance explicit even when using snapshot rates.
            if cost.cost_source == CostSource.PROVIDER_REPORTED:
                pass
            cost = cost.model_copy(update={"provider": self.name, "model": request.model})

        finish = FinishReason.TOOL_CALLS if tool_calls else FinishReason.STOP
        return LLMResponse(
            provider=self.name,
            requested_model=request.model,
            resolved_model=request.model,
            content=content,
            tool_calls=tool_calls,
            usage=self.usage,
            cost=cost,
            latency_ms=max(self.latency_ms, elapsed),
            finish_reason=finish,
            provider_request_id=f"mock-{self._request_key(request)}",
            attempt=1,
            raw_metadata={"mock": True, "provenance": "mock_test_only"},
            is_mock=True,
        )
