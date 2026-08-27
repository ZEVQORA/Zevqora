from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class PlanStatus(StrEnum):
    DRAFT = "DRAFT"
    READY = "READY"
    BLOCKED = "BLOCKED"
    EXECUTING = "EXECUTING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class ExecutionStatus(StrEnum):
    PLANNED = "PLANNED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"


class StrategyName(StrEnum):
    EXACT_REUSE = "exact_reuse"
    MODEL_SUBSTITUTION = "model_substitution"


class ErrorCategory(StrEnum):
    TIMEOUT = "timeout"
    RATE_LIMIT = "rate_limit"
    PROVIDER_5XX = "provider_5xx"
    INVALID_MODEL = "invalid_model"
    AUTH = "authentication"
    MALFORMED = "malformed_response"
    BUDGET_EXCEEDED = "budget_exceeded"
    INELIGIBLE = "ineligible"
    UNKNOWN = "unknown"


# Evidence provenance labels — never confuse these.
LEGACY_CANDIDATE_EVIDENCE = "LEGACY_CANDIDATE_EVIDENCE"
EXECUTION_PROVEN = "EXECUTION_PROVEN"


class EligibilityResult(BaseModel):
    eligible: bool
    reason: str
    blocked: bool = False
    evidence_trace_ids: list[str] = Field(default_factory=list)
    cache_groups: dict[str, list[str]] = Field(default_factory=dict)
    details: dict[str, Any] = Field(default_factory=dict)


class SampleResult(BaseModel):
    baseline_trace_id: str
    status: Literal["succeeded", "failed", "skipped"] = "succeeded"
    output_text: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None
    cost_usd: float | None = None
    cost_source: str | None = None
    pricing_version: str | None = None
    latency_ms: float | None = None
    provider_request_id: str | None = None
    provider_call_count: int = 0
    reused_from_trace_id: str | None = None
    baseline_cost_usd: float | None = None
    candidate_cost_delta_usd: float | None = None
    error_category: str | None = None
    error_detail: str | None = None
    execution_proven: bool = True
    evidence_label: str = EXECUTION_PROVEN


class PlanDraft(BaseModel):
    strategy: StrategyName
    status: PlanStatus
    finding_id: str | None = None
    baseline_config: dict[str, Any] = Field(default_factory=dict)
    candidate_config: dict[str, Any] = Field(default_factory=dict)
    reason: str
    expected_mechanism: str
    risk: str = "medium"
    fallback: str = "retain_baseline"
    required_evidence: list[str] = Field(default_factory=list)
    max_budget_usd: float = 0.0
    sample_scope: list[str] = Field(default_factory=list)
    plan_version: str = "v1"
    blocked_reason: str | None = None
