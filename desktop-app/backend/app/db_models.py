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

    ai_calls: Mapped[list[AICall]] = relationship(cascade="all, delete-orphan")
    findings: Mapped[list[Finding]] = relationship(cascade="all, delete-orphan")
    traces: Mapped[list[Trace]] = relationship(cascade="all, delete-orphan")
    experiments: Mapped[list[Experiment]] = relationship(cascade="all, delete-orphan")
    implementations: Mapped[list[Implementation]] = relationship(cascade="all, delete-orphan")
    candidate_plans: Mapped[list[CandidatePlan]] = relationship(cascade="all, delete-orphan")
    candidate_executions: Mapped[list[CandidateExecution]] = relationship(cascade="all, delete-orphan")


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
