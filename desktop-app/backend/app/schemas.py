from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    version: str
    # True when any model-provider path exists (device-local key or platform session).
    openrouter_configured: bool
    provider_mode: Literal["local_key", "platform", "none"] = "none"
    platform_connected: bool = False


class PlatformSessionRequest(BaseModel):
    base_url: str = Field(max_length=300)
    access_token: str = Field(min_length=20, max_length=8000)
    user_id: str | None = Field(default=None, max_length=80)
    email: str | None = Field(default=None, max_length=200)
    workspace_id: str | None = Field(default=None, max_length=80)
    project_id: str | None = Field(default=None, max_length=80)
    plan: str | None = Field(default=None, max_length=40)


class PlatformStatusOut(BaseModel):
    mode: Literal["local_key", "platform", "none"]
    connected: bool
    base_url: str | None = None
    user_id: str | None = None
    email: str | None = None
    workspace_id: str | None = None
    project_id: str | None = None
    plan: str | None = None
    token_fingerprint: str | None = None
    candidate_models: list[str] = Field(default_factory=list)
    pricing_version: str | None = None
    pricing_synced: bool = False
    pricing_models: int = 0
    note: str = "The access token is held in memory only; the provider credential never reaches this device."


class ImplementationDecisionRequest(BaseModel):
    decision: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=2000)


class ImplementationGitContextOut(BaseModel):
    implementation_id: str
    branch_name: str
    worktree_path: str
    worktree_exists: bool
    remote_url: str | None
    remote_host: str | None
    default_branch: str
    compare_url: str | None
    pushed_at: datetime | None
    pr_url: str | None
    status: str


class ImplementationPushOut(BaseModel):
    ok: bool
    output: str
    compare_url: str | None
    pushed_at: datetime | None


class ConnectLocalRequest(BaseModel):
    path: str = Field(min_length=1)
    name: str | None = Field(default=None, max_length=200)


class MonitoringRequest(BaseModel):
    enabled: bool


class ProductOut(BaseModel):
    id: str
    name: str
    root_path: str
    monitoring_enabled: bool
    created_at: datetime
    last_scan_at: datetime | None


class AICallOut(BaseModel):
    id: str
    file_path: str
    line: int
    provider: str
    symbol: str | None
    excerpt: str


class FindingOut(BaseModel):
    id: str
    origin: str
    category: str
    title: str
    root_cause: str
    file_path: str
    line: int
    symbol: str | None
    confidence: float
    risk: str
    evidence_status: str


class ScanResult(BaseModel):
    product: ProductOut
    files_scanned: int
    ai_calls: list[AICallOut]
    findings: list[FindingOut]
    detected_stack: list[str]
    skipped_sensitive_paths: int


class TraceIn(BaseModel):
    request_id: str
    timestamp: datetime | None = None
    symbol: str | None = None
    workflow: str | None = None
    provider: str | None = None
    model: str | None = None
    input_text: str | None = None
    output_text: str | None = None
    expected_output: str | None = None
    candidate_output: str | None = None
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    latency_ms: float | None = Field(default=None, ge=0)
    candidate_latency_ms: float | None = Field(default=None, ge=0)
    cost_usd: float | None = Field(default=None, ge=0)
    candidate_cost_usd: float | None = Field(default=None, ge=0)
    protected: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class TraceImportRequest(BaseModel):
    traces: list[TraceIn] = Field(default_factory=list)
    jsonl: str | None = None


class TraceImportResponse(BaseModel):
    imported: int
    rejected: int
    errors: list[str]


class EconomicsOut(BaseModel):
    trace_count: int
    observed_cost_usd: float | None
    avg_cost_per_trace_usd: float | None
    avg_latency_ms: float | None
    first_evidence_at: datetime | None
    latest_evidence_at: datetime | None
    providers: dict[str, int]
    verified_savings_usd: float
    verified_experiments: int
    note: str


class GateOut(BaseModel):
    name: str
    passed: bool
    detail: str


class ExperimentRunRequest(BaseModel):
    finding_id: str | None = None
    # gt=0: a zero quality gate passes every candidate and makes the word
    # VERIFIED meaningless. The UI sends Number('') === 0 on a cleared field.
    quality_gate: float = Field(default=0.98, gt=0, le=1)
    min_samples: int = Field(default=5, ge=1, le=100000)
    max_latency_regression_pct: float = Field(default=20.0, ge=0, le=1000)
    fallback_exists: bool = False


class ExperimentOut(BaseModel):
    id: str
    product_id: str
    finding_id: str | None
    status: Literal["VERIFIED", "REJECTED", "NEEDS_EVIDENCE"]
    sample_size: int
    baseline_cost_usd: float | None
    candidate_cost_usd: float | None
    verified_savings_usd: float | None
    baseline_quality: float | None
    candidate_quality: float | None
    baseline_latency_ms: float | None
    candidate_latency_ms: float | None
    gates: list[GateOut]
    evidence_version: str
    verification_source: str = "LEGACY_CANDIDATE_EVIDENCE"
    execution_proven: bool = False
    evaluation_run_id: str | None = None
    candidate_execution_id: str | None = None
    created_at: datetime


class ImplementationPrepareRequest(BaseModel):
    experiment_id: str
    instructions: str | None = Field(default=None, max_length=4000)
    model: str | None = Field(default=None, max_length=240)
    run_tests: bool = False
    test_command: str | None = Field(default=None, max_length=1000)


class ImplementationOut(BaseModel):
    id: str
    product_id: str
    experiment_id: str
    finding_id: str | None
    status: str
    branch_name: str
    worktree_path: str
    target_file: str
    summary: str
    diff_text: str
    test_command: str | None
    test_exit_code: int | None
    test_output: str | None
    model: str
    created_at: datetime
    review_note: str | None = None
    reviewed_at: datetime | None = None
    pushed_at: datetime | None = None
    remote_url: str | None = None
    pr_url: str | None = None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AgentChatRequest(BaseModel):
    product_id: str | None = None
    messages: list[ChatMessage]
    model: str | None = None


class ToolEvent(BaseModel):
    name: str
    status: str
    summary: str


class AgentChatResponse(BaseModel):
    message: str
    model: str
    provider: str
    tool_events: list[ToolEvent]
    openrouter_configured: bool


class OptimizationPlanCreateRequest(BaseModel):
    finding_id: str | None = None
    strategy: Literal["exact_reuse", "model_substitution", "bounded_routing"] | None = None
    candidate_model: str | None = Field(default=None, max_length=160)
    max_budget_usd: float | None = Field(default=None, ge=0, le=1000)


class OptimizationPlanOut(BaseModel):
    id: str
    product_id: str
    finding_id: str | None
    strategy: str
    status: str
    reason: str
    expected_mechanism: str
    risk: str
    fallback: str
    max_budget_usd: float
    sample_scope: list[str]
    baseline_config: dict[str, Any]
    candidate_config: dict[str, Any]
    required_evidence: list[str]
    plan_version: str
    config_hash: str
    blocked_reason: str | None
    created_at: datetime


class OptimizationExecuteRequest(BaseModel):
    force_rerun: bool = False
    project_to_legacy_traces: bool = False


class OptimizationExecutionOut(BaseModel):
    id: str
    candidate_plan_id: str
    product_id: str
    status: str
    execution_key: str
    attempt: int
    parent_execution_id: str | None
    provider: str | None
    requested_model: str | None
    resolved_model: str | None
    started_at: datetime | None
    completed_at: datetime | None
    baseline_trace_ids: list[str]
    sample_results: list[dict[str, Any]]
    input_tokens: int | None
    output_tokens: int | None
    cached_input_tokens: int | None
    cost_usd: float | None
    cost_source: str | None
    pricing_version: str | None
    latency_ms: float | None
    provider_request_id: str | None
    provider_call_count: int
    candidate_cost_delta_usd: float | None
    error_category: str | None
    error_detail: str | None
    fallback_used: bool
    provenance_hash: str
    created_at: datetime
    note: str = "candidate measured cost / cost delta only — not VERIFIED SAVINGS. Evaluation gates are Phase 3."


class EvaluationCreateRequest(BaseModel):
    candidate_execution_id: str
    finding_id: str | None = None
    cases: list[dict[str, Any]] | None = None
    gate_config: dict[str, Any] | None = None
    project_experiment: bool = True


class EvaluationOut(BaseModel):
    id: str
    product_id: str
    candidate_plan_id: str | None
    candidate_execution_id: str
    finding_id: str | None
    status: str
    evaluation_version: str
    sample_count: int
    protected_sample_count: int
    baseline_quality: float | None
    candidate_quality: float | None
    quality_delta: float | None
    baseline_cost_usd: float | None
    candidate_cost_usd: float | None
    raw_cost_delta_usd: float | None
    raw_cost_delta_percent: float | None
    baseline_latency_ms: float | None
    candidate_latency_ms: float | None
    evidence_completeness: bool
    verification_source: str
    execution_proven: bool
    evidence_version: str
    gates: list[dict[str, Any]]
    rejection_reason: str | None
    grader_config_hash: str
    gate_config_hash: str
    created_at: datetime
    completed_at: datetime | None
    note: str = (
        "Authoritative verification record. VERIFIED requires execution-proven CandidateExecution + all required gates."
    )
