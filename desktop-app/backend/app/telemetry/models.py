from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from ..providers.models import LLMResponse


class TraceTelemetryFields(BaseModel):
    """Phase 1 telemetry enrichment for Trace rows."""

    requested_model: str | None = None
    response_model: str | None = None
    provider_request_id: str | None = None
    cached_input_tokens: int | None = None
    reasoning_tokens: int | None = None
    cost_source: str | None = None
    pricing_version: str | None = None
    ttft_ms: float | None = None
    attempt: int | None = None
    retry_reason: str | None = None
    input_hash: str | None = None
    output_hash: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


def telemetry_from_llm_response(
    response: LLMResponse,
    *,
    input_text: str | None = None,
    output_text: str | None = None,
) -> TraceTelemetryFields:
    from ..core.hashing import sha256_text

    cost = response.cost
    meta = dict(response.raw_metadata or {})
    meta["is_mock"] = response.is_mock
    if response.finish_reason:
        meta["finish_reason"] = response.finish_reason.value
    return TraceTelemetryFields(
        requested_model=response.requested_model,
        response_model=response.resolved_model,
        provider_request_id=response.provider_request_id,
        cached_input_tokens=response.usage.cached_input_tokens or None,
        reasoning_tokens=response.usage.reasoning_tokens or None,
        cost_source=cost.cost_source.value if cost and cost.cost_source else None,
        pricing_version=cost.pricing_version if cost else None,
        ttft_ms=response.ttft_ms,
        attempt=response.attempt,
        retry_reason=response.retry_reason,
        input_hash=sha256_text(input_text),
        output_hash=sha256_text(output_text if output_text is not None else response.content),
        metadata=meta,
    )
