from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    version: str
    openrouter_configured: bool


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
    quality_gate: float = Field(default=0.98, ge=0, le=1)
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
