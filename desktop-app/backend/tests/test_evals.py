"""Phase 3 graders, gates, and execution-proven implementation boundary."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.content import bound_text
from app.core.db_migrate import HEAD_REVISION, ensure_schema
from app.db_models import Experiment, Finding, Product, Trace
from app.evals.graders import get_grader
from app.evals.models import EvaluationCaseSpec, GateConfig, GraderSpec
from app.evals.runner import create_and_run_evaluation
from app.implementation import service as impl_service
from app.implementation.service import ImplementationError
from app.optimization.executor import execute_plan
from app.optimization.planner import create_plans
from app.providers.mock import MockProvider
from app.providers.models import CostSource, LLMUsage
from app.schemas import ImplementationPrepareRequest


def _run(coro):
    return asyncio.run(coro)


def _session(tmp_path) -> Session:
    db_path = tmp_path / "eval.db"
    ensure_schema(f"sqlite:///{db_path.as_posix()}", backup_dir=tmp_path / "backups")
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", future=True)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)()


def _product(db: Session) -> Product:
    p = Product(
        id=str(uuid.uuid4()),
        name="Eval",
        root_path=f"/tmp/{uuid.uuid4()}",
        monitoring_enabled=False,
        created_at=datetime.now(UTC),
    )
    db.add(p)
    db.commit()
    return p


def _trace(db, product_id, *, rid, text, out, cost=0.02, protected=False, expected=None, latency=10.0):
    from app.core.hashing import sha256_text

    row = Trace(
        id=str(uuid.uuid4()),
        product_id=product_id,
        request_id=rid,
        timestamp=datetime.now(UTC),
        symbol="classify",
        workflow="support",
        provider="mock",
        model="mock/test-model",
        input_text=text,
        output_text=out,
        expected_output=expected if expected is not None else out,
        input_tokens=10,
        output_tokens=2,
        latency_ms=latency,
        cost_usd=cost,
        cost_source=CostSource.IMPORTED_EXTERNAL.value,
        input_hash=sha256_text(text),
        output_hash=sha256_text(out),
        protected=protected,
        metadata_json="{}",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_head_is_phase3(tmp_path):
    assert HEAD_REVISION == "0006_evidence_integrity"
    db = tmp_path / "h.db"
    ensure_schema(f"sqlite:///{db.as_posix()}", backup_dir=tmp_path / "b")
    import sqlite3

    conn = sqlite3.connect(str(db))
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()
    assert "evaluation_runs" in tables
    assert "evaluation_case_results" in tables


def test_graders_core_behaviors():
    exact = get_grader("exact_match")
    r = exact.grade(actual=" hello ", expected="hello", spec=GraderSpec(name="exact_match"), context={})
    assert r.passed and r.score == 1.0
    r = exact.grade(
        actual='{"b":1,"a":2}',
        expected={"a": 2, "b": 1},
        spec=GraderSpec(name="exact_match", config={"mode": "json"}),
        context={},
    )
    assert r.passed

    clf = get_grader("classification")
    ok = clf.grade(
        actual="account",
        expected="account",
        spec=GraderSpec(
            name="classification",
            config={"labels": ["billing", "technical", "account"], "expected_label": "account", "strict": True},
        ),
        context={},
    )
    assert ok.passed
    bad = clf.grade(
        actual="This is billing and also account related",
        expected="account",
        spec=GraderSpec(
            name="classification",
            config={"labels": ["billing", "technical", "account"], "expected_label": "account", "strict": True},
        ),
        context={},
    )
    assert not bad.passed

    js = get_grader("json_schema")
    assert js.grade(
        actual='{"x":"y"}',
        expected=None,
        spec=GraderSpec(
            name="json_schema", config={"schema": {"required": ["x"], "properties": {"x": {"type": "string"}}}}
        ),
        context={},
    ).passed
    assert not js.grade(
        actual="not-json",
        expected=None,
        spec=GraderSpec(name="json_schema", config={"schema": {"required": ["x"]}}),
        context={},
    ).passed

    fields = get_grader("field_accuracy")
    assert fields.grade(
        actual='{"category":"billing","priority":"high"}',
        expected={"category": "billing", "priority": "high"},
        spec=GraderSpec(name="field_accuracy"),
        context={},
    ).passed

    facts = get_grader("required_facts")
    assert facts.grade(
        actual="Reset the password then contact support",
        expected=None,
        spec=GraderSpec(name="required_facts", config={"facts": ["password", "support"]}),
        context={},
    ).passed

    tools = get_grader("tool_selection")
    assert not tools.grade(
        actual=None,
        expected=None,
        spec=GraderSpec(
            name="tool_selection",
            config={"forbidden_tools": ["delete_product"], "tool_calls": [{"name": "delete_product"}]},
        ),
        context={},
    ).passed

    targs = get_grader("tool_arguments")
    assert not targs.grade(
        actual=None,
        expected=None,
        spec=GraderSpec(
            name="tool_arguments",
            config={
                "tool_name": "scan",
                "required_args": {"product_id": "p1"},
                "tool_calls": [{"name": "scan", "arguments": {"product_id": "OTHER"}}],
            },
        ),
        context={"product_id": "p1"},
    ).passed


def test_bound_text_preserves_hash_and_truncation_metadata():
    big = "x" * 60_000
    bounded = bound_text(big, max_chars=1000)
    assert bounded.truncated is True
    assert bounded.full_hash
    assert bounded.stored_chars == 1000
    assert bounded.original_chars == 60_000


def _exec_fixture(db, product_id, *, n=5, candidate_out="account", candidate_cost=0.01, quality_ok=True):
    """Build n non-protected baseline traces + SUCCEEDED CandidateExecution.

    Traces stay unprotected so model_substitution can sample them. Mark
    EvaluationCaseSpec.protected separately when testing protected-slice gates.
    """
    for i in range(n):
        expected = "account" if quality_ok else "billing"
        out = "account"
        _trace(
            db,
            product_id,
            rid=f"b{i}",
            text=f"Classify support message {i}: cannot reset password",
            out=out,
            expected=expected,
            cost=0.02,
            latency=12.0,
            protected=False,
        )
    # Monkeypatch settings in caller
    plans = create_plans(
        db,
        product_id,
        strategy="model_substitution",
        candidate_model="mock/test-model",
        max_budget_usd=1.0,
    )
    plan = plans[0]
    assert plan.status == "READY", plan.blocked_reason
    mock = MockProvider(
        default_content=candidate_out,
        usage=LLMUsage(input_tokens=10, output_tokens=1, total_tokens=11),
        provider_cost_usd=candidate_cost,
        latency_ms=8.0,
    )
    execution = _run(execute_plan(db, product_id, plan.id, provider=mock))
    return plan, execution


def test_verified_fixture_and_legacy_blocks_implementation(tmp_path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.candidate_models", ("mock/test-model",))
    monkeypatch.setattr("app.core.config.settings.max_experiment_cost_usd", 1.0)
    monkeypatch.setattr(
        "app.optimization.strategies.model_substitution.settings.candidate_models", ("mock/test-model",)
    )
    monkeypatch.setattr("app.optimization.strategies.model_substitution.settings.max_candidate_samples", 10)

    db = _session(tmp_path)
    try:
        p = _product(db)
        finding_id = str(uuid.uuid4())
        db.add(
            Finding(
                id=finding_id,
                product_id=p.id,
                origin="static_scan",
                category="classification",
                title="t",
                root_cause="r",
                file_path="service.py",
                line=1,
                symbol="classify",
                confidence=0.9,
                risk="low",
                evidence_status="needs_evidence",
            )
        )
        db.commit()

        plan, execution = _exec_fixture(db, p.id, n=5, candidate_out="account", candidate_cost=0.01)
        cases = []
        samples = json.loads(execution.sample_results_json)
        for s in samples:
            cases.append(
                EvaluationCaseSpec(
                    case_id=f"c-{s['baseline_trace_id']}",
                    baseline_trace_id=s["baseline_trace_id"],
                    protected=False,
                    graders=[
                        GraderSpec(
                            name="classification",
                            config={
                                "labels": ["billing", "technical", "account"],
                                "expected_label": "account",
                                "strict": True,
                            },
                        )
                    ],
                    expected="account",
                )
            )
        # Mark first protected + passing
        cases[0].protected = True

        run = create_and_run_evaluation(
            db,
            p.id,
            candidate_execution_id=execution.id,
            finding_id=finding_id,
            cases=cases,
            gate_config=GateConfig(
                min_samples=5,
                quality_floor=0.95,
                non_inferiority_tolerance=0.0,
                require_cost_improvement=True,
                require_latency=True,
                require_fallback=True,
                max_latency_regression_pct=50.0,
            ),
            project_experiment=True,
        )
        assert run.status == "VERIFIED", run.rejection_reason
        assert run.execution_proven is True

        # Legacy perfect cheaper experiment must NOT unlock implementation.
        legacy = Experiment(
            id=str(uuid.uuid4()),
            product_id=p.id,
            finding_id=finding_id,
            status="VERIFIED",
            sample_size=5,
            baseline_cost_usd=1.0,
            candidate_cost_usd=0.1,
            verified_savings_usd=0.9,
            baseline_quality=1.0,
            candidate_quality=1.0,
            gates_json="[]",
            evidence_version="legacy",
            verification_source="LEGACY_CANDIDATE_EVIDENCE",
            execution_proven=False,
        )
        db.add(legacy)
        db.commit()
        with pytest.raises(ImplementationError, match="not execution-proven"):
            _run(impl_service.prepare_implementation(db, p.id, ImplementationPrepareRequest(experiment_id=legacy.id)))

        # Projected execution-proven experiment should be linked.
        projected = db.scalar(select(Experiment).where(Experiment.evaluation_run_id == run.id))
        assert projected is not None
        assert projected.execution_proven is True
    finally:
        db.close()


def test_quality_regression_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.candidate_models", ("mock/test-model",))
    monkeypatch.setattr(
        "app.optimization.strategies.model_substitution.settings.candidate_models", ("mock/test-model",)
    )
    monkeypatch.setattr("app.optimization.strategies.model_substitution.settings.max_candidate_samples", 10)
    db = _session(tmp_path)
    try:
        p = _product(db)
        _, execution = _exec_fixture(db, p.id, n=5, candidate_out="billing", candidate_cost=0.01, quality_ok=True)
        samples = json.loads(execution.sample_results_json)
        cases = [
            EvaluationCaseSpec(
                case_id=f"c-{s['baseline_trace_id']}",
                baseline_trace_id=s["baseline_trace_id"],
                graders=[
                    GraderSpec(
                        name="classification",
                        config={
                            "labels": ["billing", "technical", "account"],
                            "expected_label": "account",
                            "strict": True,
                        },
                    )
                ],
                expected="account",
            )
            for s in samples
        ]
        run = create_and_run_evaluation(
            db,
            p.id,
            candidate_execution_id=execution.id,
            cases=cases,
            gate_config=GateConfig(min_samples=5, quality_floor=0.95, require_fallback=True),
            project_experiment=False,
        )
        assert run.status == "REJECTED"
    finally:
        db.close()


def test_protected_failure_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.candidate_models", ("mock/test-model",))
    monkeypatch.setattr(
        "app.optimization.strategies.model_substitution.settings.candidate_models", ("mock/test-model",)
    )
    monkeypatch.setattr("app.optimization.strategies.model_substitution.settings.max_candidate_samples", 10)
    db = _session(tmp_path)
    try:
        p = _product(db)
        _, execution = _exec_fixture(db, p.id, n=5, candidate_out="account", candidate_cost=0.01)
        samples = json.loads(execution.sample_results_json)
        cases = []
        for i, s in enumerate(samples):
            cases.append(
                EvaluationCaseSpec(
                    case_id=f"c-{s['baseline_trace_id']}",
                    baseline_trace_id=s["baseline_trace_id"],
                    protected=(i == 0),
                    graders=[
                        GraderSpec(
                            name="classification",
                            config={
                                "labels": ["billing", "technical", "account"],
                                "expected_label": "billing" if i == 0 else "account",
                                "strict": True,
                            },
                        )
                    ],
                    expected="billing" if i == 0 else "account",
                )
            )
        run = create_and_run_evaluation(
            db,
            p.id,
            candidate_execution_id=execution.id,
            cases=cases,
            gate_config=GateConfig(
                # Lowest valid floor: this test asserts the protected-slice gate,
                # not the quality gate. A zero floor is no longer a legal config.
                min_samples=5,
                quality_floor=0.01,
                non_inferiority_tolerance=1.0,
                require_fallback=True,
            ),
            project_experiment=False,
        )
        assert run.status == "REJECTED"
        gates = json.loads(run.gates_json)
        assert any(g["name"] == "protected_slice" and g["outcome"] == "failed" for g in gates)
    finally:
        db.close()


def test_min_samples_incomplete(tmp_path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.candidate_models", ("mock/test-model",))
    monkeypatch.setattr(
        "app.optimization.strategies.model_substitution.settings.candidate_models", ("mock/test-model",)
    )
    monkeypatch.setattr("app.optimization.strategies.model_substitution.settings.max_candidate_samples", 10)
    db = _session(tmp_path)
    try:
        p = _product(db)
        _, execution = _exec_fixture(db, p.id, n=1, candidate_out="account", candidate_cost=0.01)
        samples = json.loads(execution.sample_results_json)
        cases = [
            EvaluationCaseSpec(
                case_id="only",
                baseline_trace_id=samples[0]["baseline_trace_id"],
                graders=[
                    GraderSpec(
                        name="classification",
                        config={"labels": ["account"], "expected_label": "account", "strict": True},
                    )
                ],
                expected="account",
            )
        ]
        run = create_and_run_evaluation(
            db,
            p.id,
            candidate_execution_id=execution.id,
            cases=cases,
            # Asserts the min_samples gate; floor kept at the lowest legal value.
            gate_config=GateConfig(min_samples=5, quality_floor=0.01, require_fallback=True),
            project_experiment=False,
        )
        assert run.status == "INCOMPLETE"
    finally:
        db.close()


def test_gate_decide_status_cost_latency_missing_and_failures():
    from app.evals.gates import decide_status, evaluate_gates
    from app.evals.models import GateConfig, GateOutcome

    base_kwargs = dict(
        sample_count=5,
        protected_failures=0,
        protected_count=0,
        baseline_quality=1.0,
        candidate_quality=1.0,
        fallback_configured=True,
        execution_succeeded=True,
        execution_proven=True,
        evidence_complete=True,
        missing_reasons=[],
        case_errors=0,
    )

    missing_cost = evaluate_gates(
        config=GateConfig(require_cost_improvement=True, require_latency=False, require_fallback=True),
        baseline_cost=None,
        candidate_cost=0.01,
        baseline_latency=10.0,
        candidate_latency=8.0,
        **base_kwargs,
    )
    assert decide_status(missing_cost) == "INCOMPLETE"
    assert any(g.name == "cost_improvement" and g.outcome == GateOutcome.MISSING for g in missing_cost)

    expensive = evaluate_gates(
        config=GateConfig(require_cost_improvement=True, require_latency=False, require_fallback=True),
        baseline_cost=0.01,
        candidate_cost=0.05,
        baseline_latency=10.0,
        candidate_latency=8.0,
        **base_kwargs,
    )
    assert decide_status(expensive) == "REJECTED"
    assert any(g.name == "cost_improvement" and g.outcome == GateOutcome.FAILED for g in expensive)

    missing_lat = evaluate_gates(
        config=GateConfig(require_cost_improvement=False, require_latency=True, require_fallback=True),
        baseline_cost=0.05,
        candidate_cost=0.01,
        baseline_latency=10.0,
        candidate_latency=None,
        **base_kwargs,
    )
    assert decide_status(missing_lat) == "INCOMPLETE"

    lat_reg = evaluate_gates(
        config=GateConfig(
            require_cost_improvement=False,
            require_latency=True,
            require_fallback=True,
            max_latency_regression_pct=10.0,
        ),
        baseline_cost=0.05,
        candidate_cost=0.01,
        baseline_latency=10.0,
        candidate_latency=20.0,
        **base_kwargs,
    )
    assert decide_status(lat_reg) == "REJECTED"


def test_phase2_smoke_semantics_one_sample_is_incomplete(tmp_path, monkeypatch):
    """Known Phase 2 real smoke: expected=account, candidate=account.

    With default min_samples=5, a single perfect classification sample must be
    INCOMPLETE — not investor-grade VERIFIED.
    """
    monkeypatch.setattr("app.core.config.settings.candidate_models", ("mock/test-model",))
    monkeypatch.setattr(
        "app.optimization.strategies.model_substitution.settings.candidate_models", ("mock/test-model",)
    )
    monkeypatch.setattr("app.optimization.strategies.model_substitution.settings.max_candidate_samples", 10)
    db = _session(tmp_path)
    try:
        p = _product(db)
        _, execution = _exec_fixture(db, p.id, n=1, candidate_out="account", candidate_cost=0.000006)
        samples = json.loads(execution.sample_results_json)
        assert samples[0].get("output_text", "").strip().lower() == "account"
        run = create_and_run_evaluation(
            db,
            p.id,
            candidate_execution_id=execution.id,
            cases=[
                EvaluationCaseSpec(
                    case_id="phase2-smoke",
                    baseline_trace_id=samples[0]["baseline_trace_id"],
                    graders=[
                        GraderSpec(
                            name="classification",
                            config={
                                "labels": ["billing", "technical", "account"],
                                "expected_label": "account",
                                "strict": True,
                            },
                        )
                    ],
                    expected="account",
                )
            ],
            gate_config=GateConfig(min_samples=5, quality_floor=0.95, require_fallback=True),
            project_experiment=False,
        )
        assert run.status == "INCOMPLETE"
        assert run.candidate_quality == 1.0
    finally:
        db.close()
