"""Regressions found while walking the desktop flow end to end.

1. A classification label that already sits in the default label list was added
   a second time, so a correct candidate output produced two "hits" and the
   strict grader rejected it as ambiguous. Exact reuse on a billing/technical/
   account workload could therefore never be VERIFIED.
2. An evaluation projected onto an Experiment row stores evaluation-shaped
   gates; the experiments listing parsed them as legacy gates and returned 500.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from app.db_models import CandidateExecution, Experiment, Trace
from app.evals.graders import ClassificationGrader
from app.evals.models import GraderSpec
from app.evals.runner import _default_cases_from_execution, _label_pool
from app.experiments.service import _to_out


def test_duplicate_label_is_not_ambiguous():
    grader = ClassificationGrader()
    spec = GraderSpec(
        name="classification",
        config={"labels": ["billing", "technical", "billing"], "expected_label": "billing", "strict": True},
    )
    result = grader.grade(actual="billing", expected="billing", spec=spec, context={})
    assert result.passed is True
    assert result.score == 1.0


def _trace(product_id: str, expected: str) -> Trace:
    return Trace(
        id=str(uuid.uuid4()),
        product_id=product_id,
        request_id=str(uuid.uuid4()),
        expected_output=expected,
        output_text=expected,
    )


def test_default_cases_use_evidence_vocabulary_without_duplicates():
    product_id = str(uuid.uuid4())
    traces = {
        t.id: t for t in (_trace(product_id, "billing"), _trace(product_id, "technical"), _trace(product_id, "refund"))
    }
    samples = [
        {"baseline_trace_id": tid, "status": "succeeded", "output_text": t.expected_output} for tid, t in traces.items()
    ]
    execution = CandidateExecution(
        id=str(uuid.uuid4()),
        candidate_plan_id=str(uuid.uuid4()),
        product_id=product_id,
        status="SUCCEEDED",
        execution_key="k",
        sample_results_json=json.dumps(samples),
    )
    assert _label_pool(samples, traces) == ["billing", "technical", "refund"]
    cases = _default_cases_from_execution(execution, traces)
    assert len(cases) == 3
    for case in cases:
        labels = case.graders[0].config["labels"]
        assert len(labels) == len(set(labels)), labels
        assert case.graders[0].config["expected_label"] in labels
        assert "refund" in labels


def test_experiment_out_accepts_evaluation_shaped_gates():
    exp = Experiment(
        id=str(uuid.uuid4()),
        product_id=str(uuid.uuid4()),
        status="VERIFIED",
        sample_size=3,
        gates_json=json.dumps(
            [
                {
                    "name": "minimum_samples",
                    "required": True,
                    "outcome": "passed",
                    "observed": 3,
                    "threshold": 3,
                    "reason": "ok",
                },
                {
                    "name": "latency_regression",
                    "required": False,
                    "outcome": "informational",
                    "observed": None,
                    "threshold": None,
                    "reason": "no latency",
                },
                {
                    "name": "quality_floor",
                    "required": True,
                    "outcome": "failed",
                    "observed": 0.8,
                    "threshold": 0.95,
                    "reason": "below floor",
                },
                {"name": "legacy", "passed": True, "detail": "legacy shape"},
            ]
        ),
        evidence_version="evals_v1",
        created_at=datetime.now(UTC),
    )
    out = _to_out(exp)
    by_name = {g.name: g for g in out.gates}
    assert by_name["minimum_samples"].passed is True
    assert by_name["latency_regression"].passed is True
    assert by_name["quality_floor"].passed is False
    assert "0.95" in by_name["quality_floor"].detail
    assert by_name["legacy"].passed is True and by_name["legacy"].detail == "legacy shape"
