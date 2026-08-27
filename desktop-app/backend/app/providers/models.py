from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class CostSource(StrEnum):
    PROVIDER_REPORTED = "provider_reported"
    PRICING_SNAPSHOT_ESTIMATE = "pricing_snapshot_estimate"
    IMPORTED_EXTERNAL = "imported_external"


class FinishReason(StrEnum):
    STOP = "stop"
    LENGTH = "length"
    TOOL_CALLS = "tool_calls"
    ERROR = "error"
    UNKNOWN = "unknown"


class ToolCall(BaseModel):
    id: str
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class LLMMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = None
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[ToolCall] | None = None


class ToolDefinition(BaseModel):
    type: Literal["function"] = "function"
    function: dict[str, Any]


class LLMUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0


class CostBreakdown(BaseModel):
    """Provenance-bearing cost. cost_usd is None when unavailable — never fake 0.0."""

    cost_usd: float | None
    cost_source: CostSource | None
    pricing_version: str | None = None
    provider: str
    model: str
    input_rate_per_million: float | None = None
    output_rate_per_million: float | None = None
    cached_rate_per_million: float | None = None
    computed_at: datetime | None = None


class LLMRequest(BaseModel):
    provider: str = "openrouter"
    model: str
    messages: list[LLMMessage]
    tools: list[ToolDefinition] | None = None
    tool_choice: str | dict[str, Any] | None = "auto"
    temperature: float = 0.2
    max_tokens: int | None = None
    timeout_seconds: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class LLMResponse(BaseModel):
    provider: str
    requested_model: str
    resolved_model: str | None = None
    content: str | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)
    usage: LLMUsage = Field(default_factory=LLMUsage)
    cost: CostBreakdown | None = None
    latency_ms: float = 0.0
    ttft_ms: float | None = None
    finish_reason: FinishReason = FinishReason.UNKNOWN
    provider_request_id: str | None = None
    attempt: int = 1
    retry_reason: str | None = None
    raw_metadata: dict[str, Any] = Field(default_factory=dict)
    is_mock: bool = False
