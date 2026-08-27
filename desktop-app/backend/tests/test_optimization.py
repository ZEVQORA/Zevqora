"""Phase 2 optimization: planning, exact reuse, model substitution, budget, idempotency."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.core.db_migrate import HEAD_REVISION, ensure_schema
from app.db_models import Product, Trace
from app.optimization.executor import execute_plan, execution_key_for
from app.optimization.models import ExecutionStatus, PlanStatus, StrategyName
from app.optimization.planner import create_plans
from app.optimization.strategies.exact_reuse import reuse_identity_hash
from app.providers.mock import MockProvider
from app.providers.models import CostSource, LLMUsage


def _run(coro):
    return asyncio.run(coro)


def _session(tmp_path) -> Session:
    db_path = tmp_path / "opt.db"
    ensure_schema(f"sqlite:///{db_path.as_posix()}", backup_dir=tmp_path / "backups")
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", future=True)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    return SessionLocal()


def _product(db: Session) -> Product:
    product = Product(
        id=str(uuid.uuid4()),
        name="Demo",
        root_path=f"/tmp/{uuid.uuid4()}",
        monitoring_enabled=False,
        created_at=datetime.now(UTC),
    )
    db.add(product)
    db.commit()
    return product


def _trace(
    db: Session,
    product_id: str,
    *,
    request_id: str,
    input_text: str,
    output_text: str,
    model: str = "mock/test-model",
    cost: float = 0.02,
    protected: bool = False,
    metadata: dict | None = None,
    symbol: str = "classify",
) -> Trace:
    from app.core.hashing import sha256_text

    row = Trace(
        id=str(uuid.uuid4()),
        product_id=product_id,
        request_id=request_id,
        timestamp=datetime.now(UTC),
        symbol=symbol,
        workflow="main",
        provider="mock",
        model=model,
        requested_model=model,
        input_text=input_text,
        output_text=output_text,
        expected_output=output_text,
        input_tokens=10,
        output_tokens=5,
        latency_ms=12.0,
        cost_usd=cost,
        cost_source=CostSource.IMPORTED_EXTERNAL.value,
        input_hash=sha256_text(input_text),
        output_hash=sha256_text(output_text),
        protected=protected,
        metadata_json=json.dumps(metadata or {}, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_migration_head_has_candidate_tables(tmp_path):
    db = tmp_path / "m.db"
    result = ensure_schema(f"sqlite:///{db.as_posix()}", backup_dir=tmp_path / "b")
    assert result.revision == HEAD_REVISION
    assert HEAD_REVISION == "0005_benchmark_dogfood"
    import sqlite3

    conn = sqlite3.connect(str(db))
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    finally:
        conn.close()
    assert "candidate_plans" in tables
    assert "candidate_executions" in tables


def test_exact_reuse_identity_differs_on_model_and_prompt(tmp_path):
    db = _session(tmp_path)
    try:
        p = _product(db)
        a = _trace(db, p.id, request_id="a", input_text="hello", output_text="world", model="m1")
        b = _trace(db, p.id, request_id="b", input_text="hello", output_text="world", model="m2")
        c = _trace(
            db,
            p.id,
            request_id="c",
            input_text="hello",
            output_text="world",
            model="m1",
            metadata={"system_prompt_version": "v2"},
        )
        d = _trace(
            db,
            p.id,
            request_id="d",
            input_text="hello",
            output_text="world",
            model="m1",
            metadata={"response_format": {"type": "json_object"}},
        )
        e = _trace(
            db,
            p.id,
            request_id="e",
            input_text="hello",
            output_text="world",
            model="m1",
            metadata={"tool_schema_hash": "abc"},
        )
        f = _trace(
            db,
            p.id,
            request_id="f",
            input_text="hello",
            output_text="world",
            model="m1",
            metadata={"temperature": 0.7},
        )
        assert reuse_identity_hash(a) != reuse_identity_hash(b)
        assert reuse_identity_hash(a) != reuse_identity_hash(c)
        assert reuse_identity_hash(a) != reuse_identity_hash(d)
        assert reuse_identity_hash(a) != reuse_identity_hash(e)
        assert reuse_identity_hash(a) != reuse_identity_hash(f)
    finally:
        db.close()


def test_execution_key_changes_when_baseline_content_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "candidate_models", ("mock/test-model",))
    monkeypatch.setattr(settings, "max_experiment_cost_usd", 1.0)
    db = _session(tmp_path)
    try:
        p = _product(db)
        t = _trace(db, p.id, request_id="r1", input_text="task-a", output_text="baseline", cost=0.05)
        plan = create_plans(
            db,
            p.id,
            strategy=StrategyName.MODEL_SUBSTITUTION.value,
            candidate_model="mock/test-model",
            max_budget_usd=1.0,
        )[0]
        key1 = execution_key_for(plan, baseline_traces=[t])
        t.input_text = "task-a-CHANGED"
        t.input_hash = None
        db.add(t)
        db.commit()
        db.refresh(t)
        key2 = execution_key_for(plan, baseline_traces=[t])
        assert key1 != key2
    finally:
        db.close()


def test_sample_results_include_case_level_fingerprints(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "candidate_models", ("mock/test-model",))
    monkeypatch.setattr(settings, "max_experiment_cost_usd", 1.0)
    db = _session(tmp_path)
    try:
        p = _product(db)
        _trace(db, p.id, request_id="r1", input_text="task-a", output_text="baseline", cost=0.05)
        plan = create_plans(
            db,
            p.id,
            strategy=StrategyName.MODEL_SUBSTITUTION.value,
            candidate_model="mock/test-model",
            max_budget_usd=1.0,
        )[0]
        mock = MockProvider(
            default_content="candidate-out",
            usage=LLMUsage(input_tokens=11, output_tokens=7, total_tokens=18),
            provider_cost_usd=0.01,
        )
        execution = _run(execute_plan(db, p.id, plan.id, provider=mock))
        samples = json.loads(execution.sample_results_json)
        assert samples[0]["task_fingerprint"]
        assert samples[0]["candidate_config_fingerprint"]
        assert samples[0]["output_hash"]
        assert samples[0]["requested_model"] == "mock/test-model"
        assert samples[0]["provider"] == "mock"
        assert samples[0]["baseline_cost_source"] == CostSource.IMPORTED_EXTERNAL.value
    finally:
        db.close()


def test_exact_reuse_eligible_and_executes_without_provider(tmp_path):
    db = _session(tmp_path)
    try:
        p = _product(db)
        t1 = _trace(db, p.id, request_id="r1", input_text="q", output_text="yes", cost=0.03)
        t2 = _trace(db, p.id, request_id="r2", input_text="q", output_text="yes", cost=0.03)
        plans = create_plans(db, p.id, strategy=StrategyName.EXACT_REUSE.value)
        assert len(plans) == 1
        plan = plans[0]
        assert plan.status == PlanStatus.READY.value
        assert t2.id in json.loads(plan.sample_scope_json)

        mock = MockProvider()
        execution = _run(execute_plan(db, p.id, plan.id, provider=mock))
        assert execution.status == ExecutionStatus.SUCCEEDED.value
        assert execution.provider_call_count == 0
        assert execution.cost_usd == 0.0
        assert execution.cost_source == CostSource.DETERMINISTIC_REUSE.value
        assert len(mock.calls) == 0
        samples = json.loads(execution.sample_results_json)
        assert samples[0]["reused_from_trace_id"] == t1.id
        assert samples[0]["output_text"] == "yes"
        # Baseline immutable
        db.refresh(t1)
        assert t1.candidate_output is None
    finally:
        db.close()


def test_exact_reuse_blocked_for_protected_and_insufficient(tmp_path):
    db = _session(tmp_path)
    try:
        p = _product(db)
        _trace(db, p.id, request_id="alone", input_text="x", output_text="y")
        plans = create_plans(db, p.id, strategy=StrategyName.EXACT_REUSE.value)
        assert plans[0].status == PlanStatus.BLOCKED.value

        p2 = _product(db)
        _trace(db, p2.id, request_id="p1", input_text="z", output_text="o", protected=True)
        _trace(db, p2.id, request_id="p2", input_text="z", output_text="o", protected=True)
        plans2 = create_plans(db, p2.id, strategy=StrategyName.EXACT_REUSE.value)
        assert plans2[0].status == PlanStatus.BLOCKED.value
    finally:
        db.close()


def test_model_substitution_requires_allowlist(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "candidate_models", ("mock/test-model",))
    db = _session(tmp_path)
    try:
        p = _product(db)
        _trace(db, p.id, request_id="r1", input_text="task", output_text="out")
        plans = create_plans(
            db,
            p.id,
            strategy=StrategyName.MODEL_SUBSTITUTION.value,
            candidate_model="evil/not-allowed",
        )
        assert plans[0].status == PlanStatus.BLOCKED.value
    finally:
        db.close()


def test_model_substitution_mock_captures_usage_cost_latency(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "candidate_models", ("mock/test-model",))
    monkeypatch.setattr(settings, "max_experiment_cost_usd", 1.0)
    db = _session(tmp_path)
    try:
        p = _product(db)
        _trace(db, p.id, request_id="r1", input_text="task-a", output_text="baseline", cost=0.05)
        plans = create_plans(
            db,
            p.id,
            strategy=StrategyName.MODEL_SUBSTITUTION.value,
            candidate_model="mock/test-model",
            max_budget_usd=1.0,
        )
        plan = plans[0]
        assert plan.status == PlanStatus.READY.value
        mock = MockProvider(
            default_content="candidate-out",
            usage=LLMUsage(input_tokens=11, output_tokens=7, total_tokens=18),
            provider_cost_usd=0.01,
            latency_ms=5.0,
        )
        execution = _run(execute_plan(db, p.id, plan.id, provider=mock))
        assert execution.status == ExecutionStatus.SUCCEEDED.value
        assert execution.provider_call_count == 1
        assert len(mock.calls) == 1
        assert execution.cost_usd == pytest.approx(0.01)
        assert execution.cost_source == CostSource.PROVIDER_REPORTED.value
        assert execution.latency_ms is not None
        assert execution.provider_request_id
        assert execution.input_tokens == 11
        assert execution.output_tokens == 7
        samples = json.loads(execution.sample_results_json)
        assert samples[0]["output_text"] == "candidate-out"
        assert samples[0]["execution_proven"] is True
        # Not VERIFIED language in note path — delta is raw only
        assert execution.candidate_cost_delta_usd == pytest.approx(0.01 - 0.05)
    finally:
        db.close()


def test_budget_refuses_overestimate(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "candidate_models", ("mock/test-model",))
    db = _session(tmp_path)
    try:
        p = _product(db)
        _trace(
            db,
            p.id,
            request_id="r1",
            input_text="big",
            output_text="out",
            cost=0.05,
        )
        row = db.scalar(select(Trace).where(Trace.product_id == p.id))
        row.input_tokens = 1_000_000
        row.output_tokens = 1_000_000
        db.add(row)
        db.commit()
        plans = create_plans(
            db,
            p.id,
            strategy=StrategyName.MODEL_SUBSTITUTION.value,
            candidate_model="mock/test-model",
            max_budget_usd=0.0000001,
        )
        # Plan may be READY with estimate in config, but execute must refuse
        plan = plans[0]
        if plan.status == PlanStatus.READY.value:
            with pytest.raises(ValueError, match="exceeds plan budget|Estimated"):
                _run(execute_plan(db, p.id, plan.id, provider=MockProvider()))
    finally:
        db.close()


def test_unknown_pricing_blocks_under_strict_budget(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "candidate_models", ("unknown/real-model",))
    db = _session(tmp_path)
    try:
        p = _product(db)
        _trace(db, p.id, request_id="r1", input_text="t", output_text="o", model="gpt-x")
        plans = create_plans(
            db,
            p.id,
            strategy=StrategyName.MODEL_SUBSTITUTION.value,
            candidate_model="unknown/real-model",
            max_budget_usd=0.5,
        )
        assert plans[0].status == PlanStatus.BLOCKED.value
        assert (
            "pricing" in (plans[0].blocked_reason or plans[0].reason).lower()
            or plans[0].blocked_reason == "unknown_pricing_under_strict_budget"
        )
    finally:
        db.close()


def test_idempotent_execute_does_not_duplicate_provider_calls(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "candidate_models", ("mock/test-model",))
    monkeypatch.setattr(settings, "max_experiment_cost_usd", 1.0)
    db = _session(tmp_path)
    try:
        p = _product(db)
        _trace(db, p.id, request_id="r1", input_text="idem", output_text="b")
        plan = create_plans(
            db,
            p.id,
            strategy=StrategyName.MODEL_SUBSTITUTION.value,
            candidate_model="mock/test-model",
            max_budget_usd=1.0,
        )[0]
        mock = MockProvider(default_content="once")
        first = _run(execute_plan(db, p.id, plan.id, provider=mock))
        second = _run(execute_plan(db, p.id, plan.id, provider=mock))
        assert first.id == second.id
        assert len(mock.calls) == 1
        rerun = _run(execute_plan(db, p.id, plan.id, provider=mock, force_rerun=True))
        assert rerun.id != first.id
        assert rerun.attempt == 2
        assert rerun.parent_execution_id == first.id
        assert len(mock.calls) == 2
        assert execution_key_for(plan) == first.execution_key == rerun.execution_key
    finally:
        db.close()


def test_provider_failure_captured(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "candidate_models", ("mock/test-model",))
    monkeypatch.setattr(settings, "max_experiment_cost_usd", 1.0)
    db = _session(tmp_path)
    try:
        p = _product(db)
        _trace(db, p.id, request_id="r1", input_text="fail", output_text="b")
        plan = create_plans(
            db,
            p.id,
            strategy=StrategyName.MODEL_SUBSTITUTION.value,
            candidate_model="mock/test-model",
            max_budget_usd=1.0,
        )[0]
        mock = MockProvider(raise_error=TimeoutError("provider timeout"))
        execution = _run(execute_plan(db, p.id, plan.id, provider=mock))
        assert execution.status == ExecutionStatus.FAILED.value
        assert execution.cost_usd is None
        samples = json.loads(execution.sample_results_json)
        assert samples[0]["status"] == "failed"
        assert samples[0]["error_category"] == "timeout"
    finally:
        db.close()


def test_concurrency_limit_respected(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "candidate_models", ("mock/test-model",))
    monkeypatch.setattr(settings, "max_candidate_concurrency", 1)
    monkeypatch.setattr(settings, "max_candidate_samples", 4)
    monkeypatch.setattr(settings, "max_experiment_cost_usd", 5.0)

    class CountingMock(MockProvider):
        def __init__(self):
            super().__init__(default_content="ok", provider_cost_usd=0.001, latency_ms=20)
            self.current = 0
            self.peak = 0

        async def complete(self, request):
            self.current += 1
            self.peak = max(self.peak, self.current)
            try:
                return await super().complete(request)
            finally:
                self.current -= 1

    db = _session(tmp_path)
    try:
        p = _product(db)
        for i in range(4):
            _trace(db, p.id, request_id=f"c{i}", input_text=f"task-{i}", output_text="b", cost=0.01)
        plan = create_plans(
            db,
            p.id,
            strategy=StrategyName.MODEL_SUBSTITUTION.value,
            candidate_model="mock/test-model",
            max_budget_usd=5.0,
        )[0]
        mock = CountingMock()
        execution = _run(execute_plan(db, p.id, plan.id, provider=mock))
        assert execution.status == ExecutionStatus.SUCCEEDED.value
        assert mock.peak <= 1
        assert len(mock.calls) == 4
    finally:
        db.close()
