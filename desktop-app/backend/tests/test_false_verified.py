"""Regressions for paths that could reach VERIFIED without real evidence.

The product's central promise is that VERIFIED means every required gate passed
on complete, real evidence. Each test here encodes one way that promise was
breakable. They are deliberately blunt: if one of these ever fails, a candidate
can be marked verified when it should not be.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.evals.gates import decide_status, evaluate_gates
from app.evals.graders import get_grader
from app.evals.models import EvaluationCaseSpec, GateConfig, GateOutcome, GraderSpec
from app.evals.runner import _reject_inflated_case_specs


def _case(case_id: str, trace_id: str, **kw) -> EvaluationCaseSpec:
    kw.setdefault("graders", [GraderSpec(name="exact_match")])
    return EvaluationCaseSpec(
        case_id=case_id,
        baseline_trace_id=trace_id,
        candidate_sample_baseline_trace_id=trace_id,
        **kw,
    )


# --- Evidence inflation --------------------------------------------------


def test_duplicate_case_ids_rejected():
    """N cases with one id must not count as N samples."""
    with pytest.raises(ValueError, match="Duplicate evaluation case_id"):
        _reject_inflated_case_specs([_case("c-1", "B1"), _case("c-1", "B2")])


def test_one_candidate_sample_cannot_count_as_many_cases():
    """Five cases bound to a single sample satisfied a five-sample gate."""
    specs = [_case(f"c-{i}", "B") for i in range(1, 6)]
    with pytest.raises(ValueError, match="reuses candidate sample"):
        _reject_inflated_case_specs(specs)


def test_case_without_graders_rejected():
    """An ungraded case contributes no quality evidence but counted as a sample."""
    with pytest.raises(ValueError, match="declares no graders"):
        _reject_inflated_case_specs([_case("c-1", "B1", graders=[])])


def test_non_positive_case_weight_rejected():
    """A negative weight let a failing case push weighted quality above 1.0."""
    with pytest.raises(ValidationError):
        _case("c-1", "B1", weight=-3.0)
    with pytest.raises(ValidationError):
        _case("c-2", "B2", weight=0.0)


# --- Gate logic ----------------------------------------------------------


def _gates(**overrides):
    kwargs = dict(
        config=GateConfig(),
        sample_count=5,
        protected_failures=0,
        protected_count=5,
        baseline_quality=0.9,
        candidate_quality=0.97,
        baseline_cost=0.02,
        candidate_cost=0.01,
        baseline_latency=100.0,
        candidate_latency=90.0,
        fallback_configured=True,
        execution_succeeded=True,
        execution_proven=True,
        evidence_complete=True,
        missing_reasons=[],
        case_errors=0,
    )
    kwargs.update(overrides)
    return evaluate_gates(**kwargs)


def _by_name(gates, name):
    return next(g for g in gates if g.name == name)


def test_baseline_is_verified_in_this_harness():
    """Guard: the happy path must actually verify, or the tests below prove nothing."""
    assert decide_status(_gates()) == "VERIFIED"


def test_latency_informational_cannot_excuse_a_required_latency_gate():
    """The flag whitelisted exactly the case it should not: required, evidence missing."""
    gates = _gates(
        config=GateConfig(require_latency=True, latency_informational=True),
        baseline_latency=None,
        candidate_latency=None,
    )
    latency = _by_name(gates, "latency_regression")
    assert latency.required is True
    assert latency.outcome == GateOutcome.MISSING
    assert decide_status(gates) != "VERIFIED"


def test_latency_informational_still_applies_when_not_required():
    gates = _gates(
        config=GateConfig(require_latency=False, latency_informational=True),
        baseline_latency=None,
        candidate_latency=None,
    )
    assert _by_name(gates, "latency_regression").required is False
    assert decide_status(gates) == "VERIFIED"


def test_empty_protected_slice_is_not_an_affirmative_pass():
    """Zero protected cases is absence of evidence, not proof of safety."""
    gate = _by_name(_gates(protected_count=0, protected_failures=0), "protected_slice")
    assert gate.outcome != GateOutcome.PASSED
    assert gate.required is False


def test_protected_coverage_can_be_required():
    gates = _gates(
        config=GateConfig(require_protected_cases=True),
        protected_count=0,
        protected_failures=0,
    )
    gate = _by_name(gates, "protected_slice")
    assert gate.required is True
    assert gate.outcome == GateOutcome.MISSING
    assert decide_status(gates) != "VERIFIED"


def test_one_protected_failure_still_rejects():
    gates = _gates(protected_count=5, protected_failures=1)
    assert _by_name(gates, "protected_slice").outcome == GateOutcome.FAILED
    assert decide_status(gates) != "VERIFIED"


# --- Graders -------------------------------------------------------------


def test_required_facts_does_not_explode_a_string_into_characters():
    """`expected="account"` must be one fact, not seven letter probes."""
    grader = get_grader("required_facts")
    result = grader.grade(
        actual="I cannot compute a route",  # contains a, c, o, u, n, t
        expected="account",
        spec=GraderSpec(name="required_facts", version="1.1.0"),
        context={},
    )
    assert result.passed is False
    assert result.score == 0.0
    assert result.details["missing"] == ["account"]


def test_required_facts_still_matches_a_genuine_fact():
    grader = get_grader("required_facts")
    result = grader.grade(
        actual="this is about your account balance",
        expected="account",
        spec=GraderSpec(name="required_facts", version="1.1.0"),
        context={},
    )
    assert result.passed is True
    assert result.score == pytest.approx(1.0)
