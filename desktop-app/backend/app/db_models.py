from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    root_path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    monitoring_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set instead of deleting when the product carries conclusive evaluation
    # evidence. Detaching must never destroy what a VERIFIED run was built on.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    ai_calls: Mapped[list[AICall]] = relationship(cascade="all, delete-orphan")
    findings: Mapped[list[Finding]] = relationship(cascade="all, delete-orphan")
    traces: Mapped[list[Trace]] = relationship(cascade="all, delete-orphan")
    experiments: Mapped[list[Experiment]] = relationship(cascade="all, delete-orphan")
    implementations: Mapped[list[Implementation]] = relationship(cascade="all, delete-orphan")
    candidate_plans: Mapped[list[CandidatePlan]] = relationship(cascade="all, delete-orphan")
    candidate_executions: Mapped[list[CandidateExecution]] = relationship(cascade="all, delete-orphan")
    evaluation_runs: Mapped[list[EvaluationRun]] = relationship(cascade="all, delete-orphan")


class AICall(Base):
    __tablename__ = "ai_calls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    line: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str] = mapped_column(String(80), nullable=False)
    symbol: Mapped[str | None] = mapped_column(String(300), nullable=True)
    excerpt: Mapped[str] = mapped_column(Text, nullable=False)


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    origin: Mapped[str] = mapped_column(String(40), nullable=False, default="static_scan")
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    root_cause: Mapped[str] = mapped_column(Text, nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    line: Mapped[int] = mapped_column(Integer, nullable=False)
    symbol: Mapped[str | None] = mapped_column(String(300), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    risk: Mapped[str] = mapped_column(String(40), nullable=False, default="medium")
    evidence_status: Mapped[str] = mapped_column(String(40), nullable=False, default="needs_evidence")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Trace(Base):
    __tablename__ = "traces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    request_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    symbol: Mapped[str | None] = mapped_column(String(300), nullable=True, index=True)
    workflow: Mapped[str | None] = mapped_column(String(300), nullable=True, index=True)
    provider: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    model: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    requested_model: Mapped[str | None] = mapped_column(String(160), nullable=True)
    response_model: Mapped[str | None] = mapped_column(String(160), nullable=True)
    provider_request_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    candidate_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cached_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reasoning_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    ttft_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    pricing_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    candidate_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    attempt: Mapped[int | None] = mapped_column(Integer, nullable=True)
    retry_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    input_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    output_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    protected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    request_snapshot_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_snapshot_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class Experiment(Base):
    __tablename__ = "experiments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    finding_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    baseline_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    verified_savings_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    gates_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    evidence_version: Mapped[str] = mapped_column(String(120), nullable=False)
    verification_source: Mapped[str] = mapped_column(String(40), nullable=False, default="LEGACY_CANDIDATE_EVIDENCE")
    execution_proven: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    evaluation_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    candidate_execution_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Implementation(Base):
    __tablename__ = "implementations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    experiment_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    finding_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    branch_name: Mapped[str] = mapped_column(String(240), nullable=False)
    worktree_path: Mapped[str] = mapped_column(Text, nullable=False)
    target_file: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    diff_text: Mapped[str] = mapped_column(Text, nullable=False)
    test_command: Mapped[str | None] = mapped_column(Text, nullable=True)
    test_exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    test_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str] = mapped_column(String(240), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    # Human review trail (0007). ZEVQORA records the decision; it never merges.
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remote_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    pr_url: Mapped[str | None] = mapped_column(Text, nullable=True)


class CandidatePlan(Base):
    """Deterministic optimization plan. Never self-marks VERIFIED."""

    __tablename__ = "candidate_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    finding_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    strategy: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    baseline_config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    candidate_config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    expected_mechanism: Mapped[str] = mapped_column(Text, nullable=False, default="")
    risk: Mapped[str] = mapped_column(String(40), nullable=False, default="medium")
    fallback: Mapped[str] = mapped_column(Text, nullable=False, default="retain_baseline")
    required_evidence_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    max_budget_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    sample_scope_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    plan_version: Mapped[str] = mapped_column(String(40), nullable=False, default="v1")
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    blocked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    executions: Mapped[list[CandidateExecution]] = relationship(cascade="all, delete-orphan")


class CandidateExecution(Base):
    """Measured candidate run. Links to immutable baseline Trace IDs; never overwrites them."""

    __tablename__ = "candidate_executions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    candidate_plan_id: Mapped[str] = mapped_column(ForeignKey("candidate_plans.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    execution_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    parent_execution_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(80), nullable=True)
    requested_model: Mapped[str | None] = mapped_column(String(160), nullable=True)
    resolved_model: Mapped[str | None] = mapped_column(String(160), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    baseline_trace_ids_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    sample_results_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cached_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    pricing_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    provider_request_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    provider_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    candidate_cost_delta_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    fallback_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    provenance_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class EvaluationRun(Base):
    """Authoritative Phase 3 verification record. Terminal rows are immutable in semantics."""

    __tablename__ = "evaluation_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    candidate_plan_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    candidate_execution_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    finding_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    evaluation_version: Mapped[str] = mapped_column(String(40), nullable=False)
    gate_system_version: Mapped[str] = mapped_column(String(40), nullable=False, default="gates_v1")
    grader_config_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    grader_config_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    gate_config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    gate_config_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    baseline_evidence_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    candidate_execution_provenance_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    protected_sample_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    baseline_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality_delta: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_cost_delta_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_cost_delta_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    evidence_completeness: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verification_source: Mapped[str] = mapped_column(String(40), nullable=False)
    execution_proven: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    evidence_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    gates_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    case_results: Mapped[list[EvaluationCaseResult]] = relationship(cascade="all, delete-orphan")


class EvaluationCaseResult(Base):
    __tablename__ = "evaluation_case_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    evaluation_run_id: Mapped[str] = mapped_column(ForeignKey("evaluation_runs.id", ondelete="CASCADE"), index=True)
    case_id: Mapped[str] = mapped_column(String(120), nullable=False)
    baseline_trace_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    candidate_execution_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    task_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    protected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    grader_specs_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    expected_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    baseline_output_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    candidate_output_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    baseline_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_grader_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    candidate_grader_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    baseline_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_cost_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    candidate_cost_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    baseline_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    case_provenance_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class BenchmarkDatasetVersion(Base):
    __tablename__ = "benchmark_dataset_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(40), nullable=False)
    dataset_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    case_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    case_manifest_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class BenchmarkRun(Base):
    __tablename__ = "benchmark_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    product_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    dataset_version_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    benchmark_version: Mapped[str] = mapped_column(String(40), nullable=False)
    baseline_config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    candidate_config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    baseline_model: Mapped[str] = mapped_column(String(160), nullable=False)
    candidate_model: Mapped[str] = mapped_column(String(160), nullable=False)
    git_commit_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    git_dirty: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    provider: Mapped[str] = mapped_column(String(80), nullable=False, default="openrouter")
    pricing_provenance_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    seed: Mapped[int] = mapped_column(Integer, nullable=False, default=42)
    case_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_case_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    protected_case_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    baseline_total_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_total_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    absolute_cost_delta: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_savings_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality_delta: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_delta_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    protected_pass_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    evaluation_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    candidate_execution_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    evidence_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    gate_config_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    grader_config_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    statistics_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    artifact_dir: Mapped[str | None] = mapped_column(Text, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class BenchmarkCaseResult(Base):
    __tablename__ = "benchmark_case_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    benchmark_run_id: Mapped[str] = mapped_column(ForeignKey("benchmark_runs.id", ondelete="CASCADE"), index=True)
    case_id: Mapped[str] = mapped_column(String(120), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(40), nullable=False)
    protected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    task_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    baseline_trace_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    candidate_execution_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    evaluation_case_result_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    baseline_model: Mapped[str | None] = mapped_column(String(160), nullable=True)
    candidate_model: Mapped[str | None] = mapped_column(String(160), nullable=True)
    baseline_output_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    candidate_output_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    baseline_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_cost_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    candidate_cost_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    baseline_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    comparable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    gate_summary_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    error_status: Mapped[str | None] = mapped_column(String(80), nullable=True)
    case_provenance_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
