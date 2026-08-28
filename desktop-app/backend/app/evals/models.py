from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

EVALUATION_VERSION = "evals_v1"
GATE_SYSTEM_VERSION = "gates_v1"

VERIFICATION_SOURCE_EXECUTION = "EXECUTION_EVALUATION"
VERIFICATION_SOURCE_LEGACY = "LEGACY_CANDIDATE_EVIDENCE"


class EvaluationStatus(StrEnum):
    PLANNED = "PLANNED"
    RUNNING = "RUNNING"
    INCOMPLETE = "INCOMPLETE"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class GateOutcome(StrEnum):
    PASSED = "passed"
    FAILED = "failed"
    MISSING = "missing"
    INFORMATIONAL = "informational"


class GraderResult(BaseModel):
    grader: str
    version: str
    score: float = Field(ge=0.0, le=1.0)
    passed: bool
    details: dict[str, Any] = Field(default_factory=dict)


class GraderSpec(BaseModel):
    name: str
    version: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class EvaluationCaseSpec(BaseModel):
    case_id: str
    baseline_trace_id: str
    candidate_sample_baseline_trace_id: str | None = None  # match sample by baseline id
    protected: bool = False
    graders: list[GraderSpec] = Field(default_factory=list)
    expected: Any = None
    reference: dict[str, Any] = Field(default_factory=dict)
    required_tools: list[str] = Field(default_factory=list)
    allowed_tools: list[str] | None = None
    forbidden_tools: list[str] = Field(default_factory=list)
    # Must be positive: a negative or zero weight lets a failing case pull the
    # weighted quality mean above 1.0 or zero out the denominator.
    weight: float = Field(default=1.0, gt=0.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class GateConfig(BaseModel):
    min_samples: int = 5
    quality_floor: float = 0.95
    non_inferiority_tolerance: float = 0.0
    require_cost_improvement: bool = True
    min_cost_improvement_pct: float = 0.0
    require_latency: bool = True
    max_latency_regression_pct: float = 20.0
    require_fallback: bool = True
    # When True, a run with zero protected cases is INCOMPLETE rather than
    # quietly unverified-but-passing. Off by default so existing flows are
    # unchanged; production/benchmark configs should turn it on.
    require_protected_cases: bool = False
    latency_informational: bool = False
    aggregation: Literal["mean"] = "mean"


class GateResult(BaseModel):
    name: str
    required: bool = True
    outcome: GateOutcome
    observed: Any = None
    threshold: Any = None
    reason: str


class EvaluationCreateRequest(BaseModel):
    candidate_execution_id: str
    finding_id: str | None = None
    cases: list[EvaluationCaseSpec] | None = None
    gate_config: GateConfig = Field(default_factory=GateConfig)
    project_experiment: bool = True
